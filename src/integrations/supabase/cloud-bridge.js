const DEMO_FOLDER_UIDS = Object.freeze([
  'board','board-docs','executive','business','business-plan','customers',
  'admin','salary','salary-forms','allowance','discipline','administration',
  'finance','sales-policy','finance-reports','hr','recruitment','training',
  'employee-records','processes','production','admin-processes','archive','supplier-contracts'
]);

/**
 * DocHub Cloud Bridge
 * Kết nối giao diện DocHub với Supabase Database & Google Drive API
 */
(() => {
  'use strict';

  const config = window.DOCHUB_CONFIG || {
    SUPABASE_URL: 'https://your-project.supabase.co',
    SUPABASE_ANON_KEY: 'your-supabase-publishable-key',
    GOOGLE_DRIVE_FOLDER_NAME: 'DocHub - Dữ liệu cá nhân',
    DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.file'
  };

  // Khởi tạo Supabase Client
  let supabase = null;
  if (window.supabase?.createClient) {
    supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  }

  let currentUser = null;
  let providerToken = null;
  let googleDriveFolderId = null;
  let revision = 1;
  let conflict = false;
  let driveSharingEnabled = false;
  let timer = null;
  let pendingState = null;
  let saveQueue = Promise.resolve();
  let authStatus = supabase ? 'checking' : 'unavailable';
  let authError = supabase ? null : 'Không tải được thư viện xác thực đám mây.';
  let authReadyResolve;
  let authReadySettled = false;
  let connectedDriveToken = null;
  let googleProviderEnabled = null;
  let workspaceLoadStatus = 'idle';
  let organization = null;
  let authorizationStatus = 'idle';
  let organizationBackend=false;
  let loadedSharedState=null;
  async function backend(action,options={}) {
    const {data,error}=await supabase.auth.getSession();
    if(error||!data?.session?.access_token)throw new Error('Vui lòng đăng nhập lại.');
    let response;
    const googleToken = connectedDriveToken || providerToken || (typeof sessionStorage!=='undefined'?sessionStorage.getItem('dochub_google_token'):null) || (typeof localStorage!=='undefined'?localStorage.getItem('dochub_google_token'):null) || null;
    try {
      response=await fetch(`/api/organization?action=${action}&organization=${encodeURIComponent(organization.id)}`,{
        ...options,
        headers:{
          Authorization:`Bearer ${data.session.access_token}`,
          ...(googleToken?{'X-Google-Access-Token':googleToken}:{}),
          ...options.headers
        }
      });
    } catch(fetchErr) {
      if(fetchErr?.name==='AbortError')throw fetchErr;
      const netErr=new Error('Mất kết nối mạng tới máy chủ DocHub. Vui lòng kiểm tra đường truyền.');
      netErr.cause=fetchErr;
      throw netErr;
    }
    if(!response.ok){
      const payload=await response.json().catch(()=>({}));
      const fallback=response.status===413?'Khối dữ liệu quá lớn đối với máy chủ. DocHub sẽ tải lại theo từng phần nhỏ.':response.status===504?'Kho Drive phản hồi quá chậm. Vui lòng giữ trang mở và thử lại.':response.status===401?'Phiên đăng nhập hoặc quyền kết nối Drive đã hết hạn. Vui lòng đăng nhập lại.':(payload.error||'Không kết nối được kho doanh nghiệp.');
      const requestError=new Error(payload.error||fallback);
      requestError.status=response.status;requestError.requestId=payload.requestId||response.headers.get('X-DocHub-Request-Id')||null;
      throw requestError;
    }
    return response;
  }

  // Khởi tạo IndexedDB cục bộ làm bộ đệm tốc độ cao
  const DB_NAME = 'dochub_cloud_cache_v1';
  function openCacheDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function cacheSet(store, key, val) {
    try {
      const db = await openCacheDB();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(val, key);
    } catch (_) {}
  }

  async function cacheGet(store, key) {
    try {
      const db = await openCacheDB();
      return await new Promise(res => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      });
    } catch (_) {
      return null;
    }
  }

  async function cacheDelete(store, key) {
    try {
      const db = await openCacheDB();
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
    } catch (_) {}
  }

  async function getDriveMeta(id) {
    const key = userCacheKey(id);
    const cached = await cacheGet('meta', key);
    if (cached?.driveId) return cached;
    if (!currentUser || !supabase) return null;

    let query = supabase
      .from('documents_index')
      .select('google_drive_file_id,mime_type,name,parent_folder_id')
      .eq('doc_uid', id)
      .not('google_drive_file_id', 'is', null);
    query = organization?.id
      ? query.eq('organization_id', organization.id)
      : query.eq('user_id', currentUser.id);
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw new Error(`Không đọc được nguồn tệp Drive: ${error.message}`);
    if (!data?.google_drive_file_id) return null;
    const meta = {
      driveId: data.google_drive_file_id,
      mime: data.mime_type || 'application/octet-stream',
      name: data.name || id,
      parentFolderId: data.parent_folder_id || 'all'
    };
    await cacheSet('meta', key, meta);
    return meta;
  }

  async function postStreamWorker(message) {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return false;
    const registration = await navigator.serviceWorker.register('/drive-stream-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller || registration.active;
    if (!worker) return false;
    return await new Promise(resolve => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => resolve(false), 3000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout);
        resolve(event.data?.ok === true);
      };
      worker.postMessage(message, [channel.port2]);
    });
  }

  // Browser cache is namespaced by Supabase user to prevent cross-account data leaks.
  function userCacheKey(key) {
    return `${currentUser?.id || 'guest'}:${organization?.id || 'personal'}:${key}`;
  }

  // Đối tượng API thay thế cho window.DocHubAPI
  const api = {
    get connected() {
      return !!currentUser;
    },
    get isDriveConnected() {
      return !!providerToken && !!googleDriveFolderId;
    },
    get usesOrganizationBackend(){return organizationBackend;},
    get user() {
      return currentUser;
    },
    get revision() {
      return revision;
    },
    get conflict() {
      return conflict;
    },
    get authStatus() {
      return authStatus;
    },
    get authError() {
      return authError;
    },
    get googleProviderEnabled() {
      return googleProviderEnabled;
    },
    get workspaceLoadStatus() {
      return workspaceLoadStatus;
    },
    get organization() {
      return organization;
    },
    get authorizationStatus() {
      return authorizationStatus;
    }
  };

  async function ensureOrganization() {
    if (!supabase || !currentUser) return null;
    authorizationStatus = 'loading';

    // 0. Check for pending invite code from URL or sessionStorage
    let pendingInvite = null;
    try {
      if (typeof sessionStorage !== 'undefined') pendingInvite = sessionStorage.getItem('dochub_pending_invite');
      if (!pendingInvite && typeof location !== 'undefined') {
        pendingInvite = new URLSearchParams(location.search).get('invite');
      }
    } catch (_) {}

    if (pendingInvite && pendingInvite.trim()) {
      try {
        const { data: joinData, error: joinErr } = await supabase.rpc('dochub_join_organization_by_invite', {
          p_invite_code: pendingInvite.trim()
        });
        if (!joinErr && joinData?.organization_id) {
          organization = { id: joinData.organization_id, role: joinData.organization_role || 'member' };
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`dochub.organization.${currentUser.id}`, organization.id);
          }
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('dochub_pending_invite');
          }
          if (typeof history !== 'undefined' && typeof location !== 'undefined') {
            const cleanUrl = new URL(location.href);
            cleanUrl.searchParams.delete('invite');
            history.replaceState(null, '', cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : '') + cleanUrl.hash);
          }
          authorizationStatus = 'ready';
          console.log(`DocHub: Đã tham gia không gian làm việc "${joinData.organization_name}" qua liên kết mời.`);
          return organization;
        } else {
          console.warn('DocHub join invite code failed:', joinErr);
          if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('dochub_pending_invite');
        }
      } catch (inviteErr) {
        console.warn('DocHub join invite error:', inviteErr);
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('dochub_pending_invite');
      }
    }

    const preferred=typeof localStorage==='undefined'?null:localStorage.getItem(`dochub.organization.${currentUser.id}`);
    if(preferred){
      const {data:member,error:memberError}=await supabase.from('organization_members').select('organization_id,organization_role').eq('user_id',currentUser.id).eq('status','active').eq('organization_id',preferred).maybeSingle();
      if(memberError)throw memberError;
      if(member){organization={id:member.organization_id,role:member.organization_role};authorizationStatus='ready';return organization;}
      localStorage.removeItem(`dochub.organization.${currentUser.id}`);
    }

    // Check if user was already invited by email where user_id is null
    if (currentUser.email) {
      try {
        const { data: emailInvites } = await supabase.from('organization_members')
          .select('id, organization_id, organization_role')
          .eq('email', currentUser.email.toLowerCase())
          .is('user_id', null)
          .in('status', ['active', 'invited'])
          .order('created_at', { ascending: false });
        if (emailInvites && emailInvites.length > 0) {
          await supabase.from('organization_members')
            .update({ user_id: currentUser.id, status: 'active' })
            .eq('id', emailInvites[0].id);
          organization = { id: emailInvites[0].organization_id, role: emailInvites[0].organization_role };
          if (typeof localStorage !== 'undefined') localStorage.setItem(`dochub.organization.${currentUser.id}`, organization.id);
          authorizationStatus = 'ready';
          return organization;
        }
      } catch (_) {}
    }

    const suggestedName = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email;
    // Check if user is already an active member of an existing organization before creating a new one
    try {
      const { data: existingMemberships } = await supabase.from('organization_members')
        .select('organization_id, organization_role')
        .eq('user_id', currentUser.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (existingMemberships && existingMemberships.length > 0) {
        organization = { id: existingMemberships[0].organization_id, role: existingMemberships[0].organization_role };
        if (typeof localStorage !== 'undefined') localStorage.setItem(`dochub.organization.${currentUser.id}`, organization.id);
        authorizationStatus = 'ready';
        return organization;
      }
    } catch (_) {}
    const { data, error } = await supabase.rpc('dochub_bootstrap_organization', {
      p_name: suggestedName ? `Không gian của ${suggestedName}` : null
    });
    if (error) {
      authorizationStatus = 'error';
      throw new Error(`Không khởi tạo được phân quyền máy chủ: ${error.message}`);
    }
    const row = Array.isArray(data) ? data[0] : data;
    organization = row ? { id: row.organization_id, role: row.organization_role } : null;
    if(organization&&typeof localStorage!=='undefined')localStorage.setItem(`dochub.organization.${currentUser.id}`,organization.id);
    authorizationStatus = organization ? 'ready' : 'error';
    return organization;
  }

  api.getInviteCode = async () => {
    if (!supabase || !organization) return null;
    try {
      const { data, error } = await supabase.rpc('dochub_get_invite_code', { p_organization_id: organization.id });
      if (!error && data) return data;
    } catch (_) {}
    try {
      const { data, error } = await supabase.from('organizations').select('invite_code').eq('id', organization.id).maybeSingle();
      if (!error && data?.invite_code) return data.invite_code;
    } catch (_) {}
    if (organizationBackend) {
      try {
        const res = await (await backend('invite-code')).json();
        if (res.inviteCode) return res.inviteCode;
      } catch (_) {}
    }
    return null;
  };

  api.resetInviteCode = async () => {
    if (!supabase || !organization) return null;
    try {
      const { data, error } = await supabase.rpc('dochub_reset_invite_code', { p_organization_id: organization.id });
      if (!error && data) return data;
    } catch (_) {}
    if (organizationBackend) {
      const res = await (await backend('invite-reset', { method: 'POST' })).json();
      if (res.inviteCode) return res.inviteCode;
    }
    throw new Error('Không thể đặt lại mã mời. Vui lòng kiểm tra quyền quản trị.');
  };

  api.listOrganizations=async()=>{
    if(!currentUser)return [];
    const {data,error}=await supabase.from('organization_members').select('organization_id,organization_role,organizations(name)').eq('user_id',currentUser.id).eq('status','active');
    if(error)throw error;
    return (data||[]).map(m=>({id:m.organization_id,role:m.organization_role,name:m.organizations?.name||'Không gian làm việc'}));
  };
  api.switchOrganization=async(id)=>{
    const memberships=await api.listOrganizations();
    if(!memberships.some(m=>m.id===id))throw new Error('Bạn không còn là thành viên của không gian này.');
    let failed=false;
    const onSync=event=>{if(event.detail?.ok===false)failed=true;};
    document.addEventListener('dochub:sync',onSync);
    try{await api.flush();}finally{document.removeEventListener('dochub:sync',onSync);}
    if(failed)throw new Error('Chưa lưu được thay đổi. Vui lòng thử lại trước khi chuyển không gian.');
    if(conflict||pendingState)throw new Error('Hãy lưu xong thay đổi trước khi chuyển không gian.');
    localStorage.setItem(`dochub.organization.${currentUser.id}`,id);
    location.assign(location.pathname+'?folder=all');
  };
  async function checkGoogleProvider() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${config.SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: config.SUPABASE_ANON_KEY },
        signal: controller.signal
      });
      if (!response.ok) return null;
      const settings = await response.json();
      googleProviderEnabled = settings?.external?.google === true;
      return googleProviderEnabled;
    } catch (_) {
      googleProviderEnabled = null;
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  function handleDriveAuthError(err) {
    if (err?.status === 401 || /invalid authentication credentials|hết hạn/i.test(err?.message || '')) {
      providerToken = null;
      connectedDriveToken = null;
      googleDriveFolderId = null;
      try {
        sessionStorage.removeItem('dochub_google_token');
        sessionStorage.removeItem('dochub_google_token_time');
        localStorage.removeItem('dochub_google_token');
        localStorage.removeItem('dochub_google_token_time');
      } catch(_) {}
      authError = 'Phiên kết nối Google Drive đã hết hạn. Mở menu tài khoản → Kết nối lại Google Drive.';
      emitAuth('DRIVE_TOKEN_EXPIRED');
    }
  }
  let folderMirrorQueue=Promise.resolve();
  function mirrorDriveFolders() {
    const task=folderMirrorQueue.catch(()=>{}).then(async()=>{
      if(organization?.role!=='owner')throw new Error('Kho Drive tổ chức phải được kết nối bởi chủ sở hữu.');
      if(!providerToken)throw new Error('Cần kết nối lại Google Drive.');
      try {
        const checked=result=>{if(result.error)throw result.error;return result.data||[];};
        const folders=checked(await supabase.from('organization_folders').select('folder_uid,parent_uid,name,deleted_at').eq('organization_id',organization.id));
        const maps=checked(await supabase.from('organization_drive_folders').select('folder_uid,drive_folder_id').eq('organization_id',organization.id));
        const ids=new Map(maps.map(row=>[row.folder_uid,row.drive_folder_id])),done=new Set(),visiting=new Set();
        async function ensure(uid){
          if(done.has(uid))return ids.get(uid);
          if(visiting.has(uid))throw new Error('Cây thư mục có vòng lặp.');
          const folder=folders.find(f=>f.folder_uid===uid&&!f.deleted_at);
          if(!folder)throw new Error('Không tìm thấy thư mục tổ chức: '+uid);
          visiting.add(uid);
          const parent=folder.parent_uid?await ensure(folder.parent_uid):null;
          const name=uid==='all'?`DocHub — ${currentUser.user_metadata?.full_name||currentUser.email}`:folder.name;
          let id=ids.get(uid);
          if(!id){
            const result=await window.DocHubDrive.getOrCreateMirroredFolder(providerToken,organization.id,uid,name,parent);
            id=result.id;
            checked(await supabase.from('organization_drive_folders').upsert({organization_id:organization.id,folder_uid:uid,drive_folder_id:id}));ids.set(uid,id);
          }
          await window.DocHubDrive.reconcileFolder(providerToken,id,name,parent);
          visiting.delete(uid);done.add(uid);return id;
        }
        for(const folder of folders.filter(f=>!f.deleted_at))await ensure(folder.folder_uid);
        googleDriveFolderId=ids.get('all');return ids;
      } catch (mirrorErr) {
        handleDriveAuthError(mirrorErr);
        throw mirrorErr;
      }
    });
    folderMirrorQueue=task;return task;
  }

  function emitAuth(event = 'AUTH_STATE_CHANGED') {
    document.dispatchEvent(new CustomEvent('dochub:auth', {
      detail: {
        event,
        status: authStatus,
        error: authError,
        connected: !!currentUser,
        driveConnected: !!providerToken && !!googleDriveFolderId,
        user: currentUser
      }
    }));
  }

  function settleReady(value) {
    if (authReadySettled) return;
    authReadySettled = true;
    authReadyResolve(value);
  }

  let sessionWork=null,sessionWorkKey=null,lastSessionKey=null;
  function applySession(session,event='INITIAL_SESSION'){
    const key=session?.user?.id?`${session.user.id}:${session.access_token||''}:${session.provider_token||''}`:null;
    if(key&&sessionWorkKey===key&&sessionWork)return sessionWork;
    if(key&&lastSessionKey===key&&organization&&authorizationStatus==='ready')return Promise.resolve(true);
    if(!key)lastSessionKey=null;
    sessionWorkKey=key;
    const work=applySessionOnce(session,event).then(result=>{if(result&&authorizationStatus==='ready')lastSessionKey=key;return result;});
    sessionWork=work;
    void work.finally(()=>{if(sessionWork===work){sessionWork=null;sessionWorkKey=null;}}).catch(()=>{});
    return work;
  }
  async function applySessionOnce(session, event = 'INITIAL_SESSION') {
    authError = googleProviderEnabled === false ?
      'Google Provider chưa được bật trong hệ thống xác thực máy chủ.' : null;
    currentUser = session?.user || null;

    if (!currentUser) {
      organization = null;
      authorizationStatus = 'idle';
      providerToken = null;
      googleDriveFolderId = null;
      connectedDriveToken = null;
      organizationBackend=false;loadedSharedState=null;
      sessionStorage.removeItem('dochub_google_token');
      sessionStorage.removeItem('dochub_google_token_time');
      authStatus = googleProviderEnabled === false ? 'configuration_required' : 'signed_out';
      emitAuth(event);
      return false;
    }

    let storedToken = null;
    try {
      const raw = sessionStorage.getItem('dochub_google_token') || localStorage.getItem('dochub_google_token');
      const time = Number(sessionStorage.getItem('dochub_google_token_time') || localStorage.getItem('dochub_google_token_time') || 0);
      if (raw && time && (Date.now() - time < 55 * 60 * 1000)) {
        storedToken = raw;
      } else if (raw) {
        sessionStorage.removeItem('dochub_google_token');
        sessionStorage.removeItem('dochub_google_token_time');
        localStorage.removeItem('dochub_google_token');
        localStorage.removeItem('dochub_google_token_time');
      }
    } catch(_) {}
    providerToken = session.provider_token || storedToken || null;
    if (session.provider_token) {
      try {
        sessionStorage.setItem('dochub_google_token', session.provider_token);
        sessionStorage.setItem('dochub_google_token_time', String(Date.now()));
        localStorage.setItem('dochub_google_token', session.provider_token);
        localStorage.setItem('dochub_google_token_time', String(Date.now()));
      } catch(_) {}
    }
    authStatus = providerToken ? 'connecting_drive' : 'authenticated';
    emitAuth(event);

    try {
      await ensureOrganization();
    } catch (authorizationError) {
      authStatus = 'authorization_error';
      authError = authorizationError.message;
      emitAuth('AUTHORIZATION_ERROR');
      return true;
    }

    if (providerToken && window.DocHubDrive && connectedDriveToken !== providerToken) {
      try {
        if(organization.role==='owner'){
          // Folder mirroring is independent of loading the workspace; do not block first paint.
          const ownerId=currentUser.id,orgId=organization.id,token=providerToken;
          setTimeout(()=>{
            if(currentUser?.id!==ownerId||organization?.id!==orgId||providerToken!==token)return;
            mirrorDriveFolders().catch(()=>{
              if(currentUser?.id===ownerId&&organization?.id===orgId){
                connectedDriveToken=null;authError='Chưa đồng bộ được cây thư mục Drive. Bạn có thể thử lại sau.';emitAuth('DRIVE_MIRROR_ERROR');
              }
            });
          },0);
        }
        else googleDriveFolderId=null;
        connectedDriveToken = providerToken;
        authStatus = 'ready';
        // Connection success is determined by backend status, not a possibly empty folder ID.
      } catch (driveErr) {
        googleDriveFolderId = null;
        connectedDriveToken = null;
        authStatus = 'drive_error';
        authError = driveErr?.message || 'Không thể kết nối Google Drive.';
        console.warn('DocHub: Lỗi kết nối Google Drive:', driveErr);
      }
    } else if (!providerToken) {
      authStatus = 'authenticated';
    }

    try {
      let status=await (await backend('status')).json();
      if(organization.role==='owner'&&session.provider_refresh_token&&(!status.connected||event==='SIGNED_IN')){
        await backend('connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:session.provider_refresh_token})});
        status = { connected: true };
      }
      organizationBackend = status?.connected === true;
      if(organization.role==='owner'&&!status?.connected){
        authError='Mở menu tài khoản → Kết nối lại Google Drive để cấp quyền cho kho doanh nghiệp.';
      }
    }catch(error){authError=error.message;console.warn('Kho doanh nghiệp:',error.message);}
    emitAuth(event);
    return true;
  }

  // Khởi tạo và kiểm tra phiên đăng nhập
  api.ready = new Promise(resolve => { authReadyResolve = resolve; });
  (async () => {
    if (!supabase) {
      console.warn('DocHub: Chưa nạp thư viện kết nối máy chủ đám mây.');
      emitAuth('CLIENT_UNAVAILABLE');
      settleReady(false);
      return;
    }

    try {
      checkGoogleProvider().then(enabled => {
        if (!currentUser && enabled === false) {
          authStatus = 'configuration_required';
          authError = 'Google Provider chưa được bật trong hệ thống xác thực máy chủ.';
          emitAuth('CONFIGURATION_REQUIRED');
        }
      });
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      const authenticated = await applySession(data?.session || null, 'INITIAL_SESSION');
      settleReady(authenticated);
    } catch (err) {
      authStatus = 'error';
      authError = err?.message || 'Không thể khôi phục phiên đăng nhập.';
      console.warn('DocHub Cloud Init Error:', err);
      emitAuth('INITIAL_SESSION_ERROR');
      settleReady(false);
    }
  })();

  if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
      // Defer async work so it does not block Supabase's internal auth callback.
      setTimeout(() => {
        applySession(session, event).catch(err => {
          authStatus = 'error';
          authError = err?.message || 'Không thể cập nhật phiên đăng nhập.';
          emitAuth('AUTH_STATE_ERROR');
        });
      }, 0);
    });
  }

  /**
   * Đọc trạng thái không gian làm việc của người dùng từ Supabase
   */
  api.loadState = async () => {
    await api.ready;
    if (!currentUser || !supabase) {
      workspaceLoadStatus = 'unavailable';
      return null;
    }

    workspaceLoadStatus = 'loading';
    async function syncMembersFromDatabase(targetState) {
      if (!targetState) return;
      if (!organization) await ensureOrganization();
      if (!organization || !['owner', 'admin'].includes(organization.role)) return;
      try {
        const { data: members } = await supabase.from('organization_members').select('*').eq('organization_id', organization.id);
        if (Array.isArray(members) && members.length) {
          const memberMap = new Map(members.map(m => [m.app_user_uid, m]));
          const emailMap = new Map(members.map(m => [m.email.toLowerCase(), m]));
          const updatedUsers = [];
          for (const u of (targetState.users || [])) {
            const dbM = memberMap.get(u.id) || emailMap.get(u.email?.toLowerCase());
            if (dbM) {
              updatedUsers.push({
                id: dbM.app_user_uid,
                name: dbM.display_name || u.name,
                email: dbM.email,
                department: dbM.department || u.department || '',
                active: dbM.status === 'active',
                groupIds: u.groupIds || []
              });
              memberMap.delete(dbM.app_user_uid);
              emailMap.delete(dbM.email.toLowerCase());
            } else {
              updatedUsers.push(u);
            }
          }
          for (const dbM of memberMap.values()) {
            if (!updatedUsers.some(u => u.id === dbM.app_user_uid || u.email.toLowerCase() === dbM.email.toLowerCase())) {
              updatedUsers.push({
                id: dbM.app_user_uid,
                name: dbM.display_name,
                email: dbM.email,
                department: dbM.department || '',
                active: dbM.status === 'active',
                groupIds: []
              });
            }
          }
          targetState.users = updatedUsers;
        }
      } catch (_) {}
    }

    async function syncFoldersFromDatabase(targetState) {
      if (!targetState) return;
      if (!organization) await ensureOrganization();
      if (!organization?.id) return;
      try {
        const { data: dbFolders, error } = await supabase.from('organization_folders').select('*').eq('organization_id', organization.id);
        if (!error && Array.isArray(dbFolders) && dbFolders.length) {
          if (!Array.isArray(targetState.folders)) targetState.folders = [];
          const folderMap = new Map(targetState.folders.map(f => [f.id, f]));
          for (const df of dbFolders) {
            if (DEMO_FOLDER_UIDS.includes(df.folder_uid)) continue;
            const existing = folderMap.get(df.folder_uid);
            if (existing) {
              if (df.name) existing.name = df.name;
              if (df.parent_uid !== undefined) existing.parentId = df.parent_uid;
              if (df.description !== undefined) existing.description = df.description || '';
              if (df.inherit_permissions !== undefined) existing.inherit = df.inherit_permissions !== false;
              if (df.deleted_at !== undefined) existing.deletedAt = df.deleted_at || null;
            } else {
              targetState.folders.push({
                id: df.folder_uid,
                parentId: df.parent_uid,
                name: df.name,
                description: df.description || '',
                kind: 'folder',
                inherit: df.inherit_permissions !== false,
                ownerId: 'u1',
                createdAt: df.created_at || new Date().toISOString(),
                updatedAt: df.updated_at || new Date().toISOString(),
                starred: false,
                deletedAt: df.deleted_at || null
              });
            }
          }
        }
      } catch (_) {}
    }

    async function syncDocumentsFromDatabase(targetState) {
      if (!targetState) return;
      if (!organization) await ensureOrganization();
      if (!organization?.id) return;
      try {
        const { data: dbDocs, error } = await supabase.from('documents_index').select('*').eq('organization_id', organization.id);
        if (!error && Array.isArray(dbDocs) && dbDocs.length) {
          if (!Array.isArray(targetState.documents)) targetState.documents = [];
          const docMap = new Map(targetState.documents.map(d => [d.id, d]));
          for (const dd of dbDocs) {
            if (DEMO_FOLDER_UIDS.includes(dd.parent_folder_id)) continue;
            const existing = docMap.get(dd.doc_uid);
            if (existing) {
              if (dd.name) existing.name = dd.name;
              if (dd.parent_folder_id) existing.parentId = dd.parent_folder_id;
              if (dd.bytes) existing.bytes = Number(dd.bytes);
              if (dd.mime_type) existing.mime = dd.mime_type;
              if (dd.deleted_at !== undefined) existing.deletedAt = dd.deleted_at || null;
              existing.assetStorage = 'server';
            } else {
              targetState.documents.push({
                id: dd.doc_uid,
                parentId: dd.parent_folder_id || 'all',
                name: dd.name,
                description: dd.description || '',
                ext: dd.ext || dd.name.split('.').pop() || 'bin',
                bytes: Number(dd.bytes) || 0,
                mime: dd.mime_type || 'application/octet-stream',
                kind: 'file',
                ownerId: 'u1',
                source: 'upload',
                assetStorage: 'server',
                createdAt: dd.created_at || new Date().toISOString(),
                updatedAt: dd.updated_at || new Date().toISOString(),
                starred: dd.starred === true,
                deletedAt: dd.deleted_at || null
              });
            }
          }
        }
      } catch (_) {}
    }

    async function syncAclFromDatabase(targetState) {
      if (!targetState) return;
      if (!organization) await ensureOrganization();
      if (!organization?.id) return;
      try {
        const { data: dbAcl, error } = await supabase
          .from('folder_acl_entries')
          .select('*, organization_members(app_user_uid, user_id, email), organization_groups(app_group_uid)')
          .eq('organization_id', organization.id);
        if (!error && Array.isArray(dbAcl) && dbAcl.length) {
          if (!Array.isArray(targetState.acl)) targetState.acl = [];
          const existingMap = new Map();
          for (const rule of targetState.acl) {
            existingMap.set(`${rule.resourceId}:${rule.principalType}:${rule.principalId}`, rule);
          }
          for (const entry of dbAcl) {
            if (DEMO_FOLDER_UIDS.includes(entry.folder_uid)) continue;
            const isMember = entry.principal_type === 'member';
            const principalId = isMember
              ? (entry.organization_members?.app_user_uid || entry.organization_members?.user_id)
              : (entry.organization_groups?.app_group_uid);
            if (!principalId) continue;
            const key = `${entry.folder_uid}:${isMember ? 'user' : 'group'}:${principalId}`;
            const existing = existingMap.get(key);
            if (existing) {
              existing.role = entry.role;
            } else {
              targetState.acl.push({
                id: 'acl-' + entry.id,
                resourceId: entry.folder_uid,
                principalType: isMember ? 'user' : 'group',
                principalId,
                role: entry.role
              });
            }
          }
        }
      } catch (err) {
        console.warn('DocHub syncAclFromDatabase:', err);
      }
    }

    function sanitizeCleanState(st) {
      if (!st) return st;
      if (Array.isArray(st.folders)) {
        st.folders = st.folders.filter(f => !DEMO_FOLDER_UIDS.includes(f.id));
      }
      if (Array.isArray(st.documents)) {
        st.documents = st.documents.filter(d => !d.sample && d.source !== 'sample' && d.source !== 'bundled' && !DEMO_FOLDER_UIDS.includes(d.parentId));
      }
      if (Array.isArray(st.acl)) {
        st.acl = st.acl.filter(a => !DEMO_FOLDER_UIDS.includes(a.resourceId));
      }
      return st;
    }

    if(organizationBackend){
      try{
        const result=await (await backend('workspace')).json();
        if(result.state){
          sanitizeCleanState(result.state);
          await syncMembersFromDatabase(result.state);
          await syncFoldersFromDatabase(result.state);
          await syncDocumentsFromDatabase(result.state);
          await syncAclFromDatabase(result.state);
          sanitizeCleanState(result.state);
        }
        loadedSharedState=result.state;
        revision=result.revision||0;
        workspaceLoadStatus=result.state?'loaded':'not_found';
        if(result.state) await cacheSet('meta', userCacheKey('workspace_state'), { state: result.state, revision });
        return result.state;
      }catch(error){
        const cached=await cacheGet('meta', userCacheKey('workspace_state'));
        if(cached?.state){
          sanitizeCleanState(cached.state);
          loadedSharedState=cached.state;revision=cached.revision||1;workspaceLoadStatus='loaded';return cached.state;
        }
        workspaceLoadStatus='error';throw error;
      }
    }
    try {
      const { data, error } = await supabase
        .from('user_workspaces')
        .select('state, revision')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (error) {
        const cached=await cacheGet('meta', userCacheKey('workspace_state'));
        if(cached?.state){
          sanitizeCleanState(cached.state);
          workspaceLoadStatus='loaded';revision=cached.revision||1;return cached.state;
        }
        workspaceLoadStatus = 'error';
        console.warn('Lỗi đọc dữ liệu từ máy chủ đám mây:', error);
        return null;
      }

      if (data && data.state) {
        sanitizeCleanState(data.state);
        await syncMembersFromDatabase(data.state);
        await syncFoldersFromDatabase(data.state);
        await syncDocumentsFromDatabase(data.state);
        await syncAclFromDatabase(data.state);
        sanitizeCleanState(data.state);
        driveSharingEnabled = data.state.preferences?.driveSharingEnabled === true;
        workspaceLoadStatus = 'loaded';
        revision = data.revision || 1;
        await cacheSet('meta', userCacheKey('workspace_state'), { state: data.state, revision });
        console.log(`DocHub: Đã tải không gian làm việc từ máy chủ đám mây (Revision ${revision})`);
        return data.state;
      }

      // Người dùng mới: Chưa có workspace trong DB -> sẽ trả về null để app khởi tạo seed ban đầu
      workspaceLoadStatus = 'not_found';
      return null;
    } catch (err) {
      const cached=await cacheGet('meta', userCacheKey('workspace_state'));
      if(cached?.state){
        sanitizeCleanState(cached.state);
        workspaceLoadStatus='loaded';revision=cached.revision||1;return cached.state;
      }
      workspaceLoadStatus = 'error';
      console.error('DocHub loadState failed:', err);
      return null;
    }
  };

  /**
   * Lập lịch lưu trạng thái (Debounce 350ms) lên Supabase
   */
  api.scheduleState = (state) => {
    if (!currentUser || conflict || !supabase) return;
    pendingState = JSON.parse(JSON.stringify(state));
    clearTimeout(timer);
    timer = setTimeout(() => api.flush(), 350);
  };

  /**
   * Đẩy ngay trạng thái đang chờ lên Supabase
   */
  api.flush = () => {
    clearTimeout(timer);
    if (!pendingState || conflict || !currentUser || !supabase) return saveQueue;

    const snapshot = pendingState;
    pendingState = null;

    saveQueue = saveQueue.then(async () => {
      try {
        if(organizationBackend&&organization?.role==='owner'&&loadedSharedState){
          for(const item of snapshot.documents||[]){const previous=loadedSharedState.documents.find(d=>d.id===item.id);if(!previous||previous.assetStorage!=='server')continue;
            if(['name','description','parentId','deletedAt'].some(k=>(item[k]||null)!==(previous[k]||null)))await backend('document-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,name:item.name,description:item.description||'',parentId:item.parentId,...(item.deletedAt?{trash:true}:{deletedAt:null})})});
          }
        }
        if(organizationBackend&&organization?.role!=='owner'){
          if(!loadedSharedState)throw new Error('Chủ sở hữu chưa khởi tạo không gian chung.');
          for(const field of ['folders','users','groups','acl'])if(JSON.stringify(snapshot[field])!==JSON.stringify(loadedSharedState[field]))throw new Error('Thay đổi cơ cấu và phân quyền cần thực hiện bằng tài khoản chủ sở hữu.');
          for(const item of snapshot.documents||[]){const previous=loadedSharedState.documents.find(d=>d.id===item.id);if(!previous)continue;
            if(['name','description','parentId','deletedAt'].some(k=>(item[k]||null)!==(previous[k]||null)))await backend('document-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,name:item.name,description:item.description||'',parentId:item.parentId,...(item.deletedAt?{trash:true}:{deletedAt:null})})});
          }
          loadedSharedState=structuredClone(snapshot);document.dispatchEvent(new CustomEvent('dochub:sync',{detail:{ok:true}}));return;
        }
        if (!organization) await ensureOrganization();
        if (organization && ['owner', 'admin'].includes(organization.role)) {
          const cleanFolders = (snapshot.folders || []).filter(f => !DEMO_FOLDER_UIDS.includes(f.id));
          const { error: authorizationError } = await supabase.rpc('dochub_sync_authorization_snapshot', {
            p_organization_id: organization.id,
            p_folders: cleanFolders,
            p_users: snapshot.users || [],
            p_groups: snapshot.groups || [],
            p_acl: (snapshot.acl || []).filter(a => !DEMO_FOLDER_UIDS.includes(a.resourceId))
          });
          if (authorizationError) throw authorizationError;
        }
        const nextRevision = revision + 1;
        const cleanSnapshot = {
          ...snapshot,
          folders: (snapshot.folders || []).filter(f => !DEMO_FOLDER_UIDS.includes(f.id)),
          documents: (snapshot.documents || []).filter(d => !d.sample && d.source !== 'sample' && d.source !== 'bundled' && !DEMO_FOLDER_UIDS.includes(d.parentId)),
          acl: (snapshot.acl || []).filter(a => !DEMO_FOLDER_UIDS.includes(a.resourceId))
        };
        const { data: savedRevision, error } = await supabase.rpc('dochub_save_workspace_snapshot', {
          p_state: cleanSnapshot,
          p_expected_revision: revision
        });
        if (error) throw error;
        const savedRow = Array.isArray(savedRevision) ? savedRevision[0] : savedRevision;
        const committedRevision = Number(savedRow?.revision);
        if (!Number.isSafeInteger(committedRevision)) throw new Error('Máy chủ không trả về revision hợp lệ.');
        revision = committedRevision;
        loadedSharedState=structuredClone(snapshot);
        if(organization?.role==='owner'&&providerToken){
          try{await mirrorDriveFolders();}
          catch(mirrorErr){console.warn('DocHub: mirrorDriveFolders background sync:', mirrorErr.message);}
        }
        driveSharingEnabled = snapshot.preferences?.driveSharingEnabled === true;
        if (!organizationBackend && driveSharingEnabled && organization && ['owner','admin'].includes(organization.role)) {
          try{await api.syncDrivePermissions();}
          catch(permErr){console.warn('DocHub: syncDrivePermissions background sync:', permErr.message);}
        }
        document.dispatchEvent(new CustomEvent('dochub:sync', { detail: { ok: true } }));
      } catch (err) {
        if(/workspace_revision_conflict|40001|revision conflict/i.test(err?.message||err?.code||'')){
          conflict=true;
          pendingState=null;
          const conflictError=new Error('Dữ liệu đã được cập nhật ở phiên khác. Tải lại trang trước khi tiếp tục để tránh ghi đè thay đổi.');
          conflictError.code='workspace_revision_conflict';
          console.warn('DocHub workspace revision conflict:',err);
          document.dispatchEvent(new CustomEvent('dochub:sync', { detail: { ok: false, error: conflictError.message, code:conflictError.code } }));
          return;
        }
        console.error('Lỗi lưu dữ liệu lên Supabase:', err);
        document.dispatchEvent(new CustomEvent('dochub:sync', { detail: { ok: false, error: err.message } }));
      }
    });

    return saveQueue;
  };

  /** Ask PostgreSQL for the effective permission of the authenticated user. */
  api.authorize = async (folderUid, action) => {
    await api.ready;
    if (!currentUser || !supabase) return false;
    if (!organization) await ensureOrganization();
    const { data, error } = await supabase.rpc('dochub_can_folder_action', {
      p_organization_id: organization.id,
      p_folder_uid: folderUid,
      p_action: action,
      p_user_id: currentUser.id
    });
    if (error) throw new Error(`Không kiểm tra được quyền trên máy chủ: ${error.message}`);
    return data === true;
  };

  api.requirePermission = async (folderUid, action) => {
    const allowed = await api.authorize(folderUid, action);
    if (!allowed) {
      const error = new Error('Bạn không có quyền thực hiện thao tác này trong thư mục đã chọn.');
      error.code = 'permission_denied';
      throw error;
    }
    return true;
  };

  /**
   * Lưu trữ tệp tài liệu: Đẩy lên Google Drive của khách hàng và lưu cache cục bộ
   */
  api.putAsset = async (id, blob, parentFolderId = 'all', options = {}) => {
    const { onProgress, signal, onUploadSession } = options;
    await api.requirePermission(parentFolderId, 'create');
    if(organizationBackend){
      const ext=options.ext||blob.name?.split('.').pop()||'';
      const abortError=()=>{const err=new Error('Đã hủy tải tệp lên.');err.name='AbortError';return err;};
      const rangeOffset=range=>{const match=/bytes=(\d+)-(\d+)/.exec(range||'');return match?Number(match[2])+1:0;};
      const clientOrigin = typeof window !== 'undefined' && window.location ? window.location.origin : null;
      const createSession=async()=>{
        let created=null,startErr=null;
        for(let sAttempt=1;sAttempt<=3;sAttempt++){
          if(signal?.aborted)throw abortError();
          try{
            const res=await backend('upload-start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,folder:parentFolderId,name:options.fileName||blob.name||id,ext,mime:blob.type,bytes:blob.size,origin:clientOrigin}),signal});
            created={...(await res.json()),createdAt:Date.now()};break;
          }catch(err){
            if(err?.name==='AbortError')throw err;
            startErr=err;
            if(sAttempt<3)await new Promise(r=>setTimeout(r,600*Math.pow(2,sAttempt-1)));
          }
        }
        if(!created)throw new Error(startErr?.message||'Không thể khởi tạo phiên tải lên Drive.');
        onUploadSession?.(created);
        return created;
      };
      let start=options.uploadSession?.id&&Date.now()-(options.uploadSession.createdAt||0)<55*60*1000?options.uploadSession:null;
      if(!start)start=await createSession();

      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
      const chunkSize = isMobile ? (2 * 1024 * 1024) : Math.min(start.chunkSize || 4 * 1024 * 1024, 4 * 1024 * 1024);
      let complete=false,driveFileId=null,directFailed=null,proxyOffset=0;

      if(options.uploadSession?.id===start.id){
        try{
          const statusResponse=await backend('upload-status&upload='+encodeURIComponent(start.id),{signal});
          const status=await statusResponse.json();
          if(status.complete){onUploadSession?.(null);onProgress?.({phase:'uploading',loaded:blob.size,total:blob.size,percent:100});return {driveStored:true,cached:false};}
          proxyOffset=rangeOffset(status.range);
        }catch(statusErr){
          if(statusErr?.name==='AbortError')throw statusErr;
          if(statusErr?.status===410){onUploadSession?.(null);start=await createSession();proxyOffset=0;}
          else console.warn('DocHub: Chưa kiểm tra được phiên tải cũ, sẽ thử tiếp:',statusErr?.message||statusErr);
        }
      }

      const activeDirectUrl=start.uploadUrl;
      if(activeDirectUrl&&typeof activeDirectUrl==='string'&&activeDirectUrl.startsWith('https://www.googleapis.com/')){
        let offset=proxyOffset;
        while(offset<blob.size){
          if(signal?.aborted)throw abortError();
          const end=Math.min(blob.size,offset+chunkSize);
          const chunk=blob.slice(offset,end);
          let chunkOk=false,lastErr=null;

          for(let attempt=1;attempt<=5;attempt++){
            if(signal?.aborted)throw abortError();
            if(attempt>1){
              onProgress?.({phase:'retrying',loaded:offset,total:blob.size,percent:Math.round(offset/blob.size*100),attempt});
              await new Promise(r=>setTimeout(r,Math.min(8000,1000*Math.pow(2,attempt-2))));
            }
            try{
              const chunkResult=await new Promise((resolve,reject)=>{
                if(signal?.aborted)return reject(abortError());
                const xhr=new XMLHttpRequest();
                const onAbort=()=>xhr.abort();
                xhr.open('PUT',activeDirectUrl);
                xhr.timeout=120000;
                xhr.setRequestHeader('Content-Type',start.mime||blob.type||'application/octet-stream');
                xhr.setRequestHeader('Content-Range',`bytes ${offset}-${end-1}/${blob.size}`);
                xhr.upload.onprogress=event=>{
                  const currentLoaded=Math.min(blob.size,offset+(event.loaded||0));
                  onProgress?.({phase:'uploading',loaded:currentLoaded,total:blob.size,percent:Math.round(currentLoaded/blob.size*100)});
                };
                xhr.onload=()=>{
                  signal?.removeEventListener('abort',onAbort);
                  if(xhr.status===200||xhr.status===201){
                    try{resolve({complete:true,data:JSON.parse(xhr.responseText)});}catch(_){reject(new Error('Google Drive trả về dữ liệu không hợp lệ.'));}
                  }else if(xhr.status===308){
                    resolve({complete:false,range:xhr.getResponseHeader('Range')});
                  }else{
                    let msg=`Lỗi Drive (${xhr.status})`;try{msg=JSON.parse(xhr.responseText).error?.message||msg;}catch(_){}
                    const err=new Error(msg);err.status=xhr.status;reject(err);
                  }
                };
                xhr.onerror=()=>{signal?.removeEventListener('abort',onAbort);reject(new Error('Mất kết nối mạng khi đang truyền tệp lên Drive.'));};
                xhr.ontimeout=()=>{signal?.removeEventListener('abort',onAbort);reject(new Error('Kết nối tải lên quá chậm. DocHub sẽ chuyển sang đường truyền dự phòng.'));};
                xhr.onabort=()=>{signal?.removeEventListener('abort',onAbort);const err=new Error('Đã hủy tải tệp lên.');err.name='AbortError';reject(err);};
                signal?.addEventListener('abort',onAbort,{once:true});
                xhr.send(chunk);
              });

              if(chunkResult.complete){
                complete=true;driveFileId=chunkResult.data?.id;offset=blob.size;chunkOk=true;break;
              }
              if(chunkResult.range){
                const m=/bytes=(\d+)-(\d+)/.exec(chunkResult.range);
                if(m&&Number(m[2])+1>=offset){offset=Number(m[2])+1;chunkOk=true;break;}
              }
              offset=end;chunkOk=true;break;
            }catch(chunkErr){
              if(chunkErr?.name==='AbortError')throw chunkErr;
              lastErr=chunkErr;
              console.warn(`DocHub: Tải khối Drive (${offset}-${end}) lần ${attempt}:`,chunkErr?.message||chunkErr);
              try{
                const statusXhr=await new Promise((res,rej)=>{const x=new XMLHttpRequest();x.open('PUT',activeDirectUrl);x.timeout=20000;x.setRequestHeader('Content-Range',`bytes */${blob.size}`);x.onload=()=>res(x);x.onerror=rej;x.ontimeout=rej;x.send();});
                if(statusXhr.status===308){
                  const r=statusXhr.getResponseHeader('Range'),m=/bytes=(\d+)-(\d+)/.exec(r||'');
                  if(m&&Number(m[2])+1>=offset){offset=Number(m[2])+1;chunkOk=true;break;}
                }else if(statusXhr.status===200||statusXhr.status===201){
                  const d=JSON.parse(statusXhr.responseText);complete=true;driveFileId=d.id;offset=blob.size;chunkOk=true;break;
                }
              }catch(_){}
            }
          }
          if(!chunkOk){
            directFailed=lastErr||new Error('Đường tải trực tiếp tới Drive bị gián đoạn.');
            break;
          }
        }

        if(complete&&driveFileId){
          let finishError=null;
          for(let fAttempt=1;fAttempt<=3;fAttempt++){
            if(signal?.aborted)throw abortError();
            try{
              await backend('upload-finish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({upload:start.id,driveFileId}),signal});
              onUploadSession?.(null);onProgress?.({phase:'uploading',loaded:blob.size,total:blob.size,percent:100});
              return {driveStored:true,cached:false};
            }catch(finishErr){
              if(finishErr?.name==='AbortError')throw finishErr;
              finishError=finishErr;
              if(fAttempt<3)await new Promise(r=>setTimeout(r,1000*fAttempt));
            }
          }
          throw finishError||new Error('Tệp đã tải lên Drive nhưng chưa ghi nhận được vào DocHub.');
        }
      }

      if(directFailed)onProgress?.({phase:'fallback',loaded:proxyOffset,total:blob.size,percent:Math.round((proxyOffset/blob.size)*100)});
      try{
        const statusResponse=await backend('upload-status&upload='+encodeURIComponent(start.id),{signal});
        const status=await statusResponse.json();
        if(status.complete){onUploadSession?.(null);onProgress?.({phase:'uploading',loaded:blob.size,total:blob.size,percent:100});return {driveStored:true,cached:false};}
        proxyOffset=rangeOffset(status.range);
      }catch(statusErr){
        if(statusErr?.name==='AbortError')throw statusErr;
        if(statusErr?.status===410){onUploadSession?.(null);start=await createSession();proxyOffset=0;}
        else if(directFailed)console.warn('DocHub: Đường tải trực tiếp lỗi, chuyển sang máy chủ trung gian:',directFailed?.message||directFailed);
      }
      const proxyChunkSize=2*1024*1024;
      while(proxyOffset<blob.size){
        if(signal?.aborted){const err=new Error('Đã hủy tải tệp lên.');err.name='AbortError';throw err;}
        const end=Math.min(blob.size,proxyOffset+proxyChunkSize);
        let chunkOk=false,lastErr=null;

        for(let attempt=1;attempt<=5;attempt++){
          if(signal?.aborted){const err=new Error('Đã hủy tải tệp lên.');err.name='AbortError';throw err;}
          if(attempt>1){
            onProgress?.({phase:'retrying',loaded:proxyOffset,total:blob.size,percent:Math.round((proxyOffset/blob.size)*100),attempt});
            const backoff=Math.min(8000,800*Math.pow(2,attempt-2));
            await new Promise(r=>setTimeout(r,backoff));
          }
          try{
            onProgress?.({phase:'uploading',loaded:proxyOffset,total:blob.size,percent:Math.round((proxyOffset/blob.size)*100)});
            const resp=await backend('upload-chunk&upload='+encodeURIComponent(start.id),{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Range':`bytes ${proxyOffset}-${end-1}/${blob.size}`},body:blob.slice(proxyOffset,end),signal});
            const result=await resp.json();
            complete=result.complete===true;
            if(complete){
              proxyOffset=blob.size;chunkOk=true;
              onProgress?.({phase:'uploading',loaded:blob.size,total:blob.size,percent:100});
              break;
            }
            if(result.range){
              const m=/bytes=(\d+)-(\d+)/.exec(result.range);
              if(m&&Number(m[2])+1>=proxyOffset){
                proxyOffset=Number(m[2])+1;chunkOk=true;
                onProgress?.({phase:'uploading',loaded:proxyOffset,total:blob.size,percent:Math.round((proxyOffset/blob.size)*100)});
                break;
              }
            }
            proxyOffset=end;chunkOk=true;
            onProgress?.({phase:'uploading',loaded:proxyOffset,total:blob.size,percent:Math.round((proxyOffset/blob.size)*100)});
            break;
          }catch(err){
            if(err?.name==='AbortError')throw err;
            lastErr=err;
            console.warn(`DocHub: Tải khối ${proxyOffset}-${end} gặp sự cố (lần ${attempt}/5):`,err.message||err);
          }
        }

        if(!chunkOk){
          const msg=lastErr?.message&&!/Failed to fetch/i.test(lastErr.message)?lastErr.message:'Mất kết nối mạng khi đang tải lên. Vui lòng kiểm tra đường truyền và thử lại.';
          throw new Error(msg);
        }
      }
      if(!complete)throw new Error('Kho doanh nghiệp chưa xác nhận tải xong.');
      onUploadSession?.(null);
      return {driveStored:true,cached:false};
    }
    if (signal?.aborted) {
      const error = new Error('Đã hủy tải tệp lên.');
      error.name = 'AbortError';
      throw error;
    }
    // 1. Luôn lưu cache cục bộ để xem trước tức thì
    onProgress?.({ phase: 'caching', loaded: 0, total: blob.size, percent: 0 });
    await cacheSet('assets', userCacheKey(id), blob);
    onProgress?.({ phase: 'connecting', loaded: 0, total: blob.size, percent: 0 });

    // 2. Nếu có kết nối Google Drive, tải lên Drive của khách
    let driveStored = false;
    if(organization?.role!=='owner'){
      onProgress?.({phase:'local',loaded:blob.size,total:blob.size,percent:100,error:'Chưa có kết nối ghi vào kho Drive chủ sở hữu. Tệp chỉ lưu trên thiết bị, không tải vào Drive cá nhân.'});
      return {driveStored:false,cached:true};
    }
    if (providerToken && googleDriveFolderId && window.DocHubDrive) {
      try {
        const folderIds=await mirrorDriveFolders();
        const destination=folderIds.get(parentFolderId);
        if(!destination)throw new Error('Chưa ánh xạ được thư mục Drive đích.');
        const fileMeta = await window.DocHubDrive.uploadFile(
          providerToken,
          destination,
          blob,
          id,
          blob.type || 'application/octet-stream',
          { onProgress, signal }
        );
        driveStored = true;
        // Lưu ánh xạ ID nội bộ -> Google Drive File ID
        await cacheSet('meta', userCacheKey(id), { driveId: fileMeta.id, webViewLink: fileMeta.webViewLink });

        // Ghi nhận vào bảng documents_index của Supabase nếu đang đăng nhập
        if (currentUser && supabase) {
          const { error: indexError } = await supabase.from('documents_index').upsert({
            user_id: currentUser.id,
            doc_uid: id,
            name: fileMeta.name || id,
            ext: /^[a-z0-9]{1,24}$/i.test(options.ext||'')?options.ext.toLowerCase():(/\.([a-z0-9]{1,24})$/i.exec(options.fileName||blob.name||'')?.[1].toLowerCase()||''),
            bytes: blob.size || 0,
            mime_type: blob.type,
            google_drive_file_id: fileMeta.id,
            organization_id: organization?.id || null,
            parent_folder_id: parentFolderId,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id,doc_uid' });
          if(indexError)throw indexError;
          try { if(driveSharingEnabled)await api.syncDrivePermissions(fileMeta.id,parentFolderId); }
          catch(error){document.dispatchEvent(new CustomEvent('dochub:sync',{detail:{ok:false,error:'Tệp đã lên Drive nhưng chưa đồng bộ quyền: '+error.message}}));}
        }
      } catch (driveErr) {
        handleDriveAuthError(driveErr);
        if (driveErr?.name === 'AbortError') {
          await cacheDelete('assets', userCacheKey(id));
          throw driveErr;
        }
        console.warn('Lỗi tải tệp lên Google Drive:', driveErr);
        onProgress?.({ phase: 'local', loaded: blob.size, total: blob.size, percent: 100, error: driveErr.message });
      }
    }
    if (!driveStored && (!providerToken || !googleDriveFolderId || !window.DocHubDrive)) {
      const reason = !providerToken ? 'Chưa kết nối Google Drive. Đăng nhập lại Google để cấp quyền Drive.' : authError || 'Không kết nối được thư mục Drive. Vui lòng kết nối lại Google Drive.';
      onProgress?.({ phase: 'local', loaded: blob.size, total: blob.size, percent: 100, error: reason });
    }
    return { driveStored, cached: true };
  };

  /**
   * Lấy tệp tài liệu: Đọc từ cache trước, nếu không có thì tải từ Google Drive
   */
  api.syncDrivePermissions = async (fileId=null,folderUid=null) => {
    if(!organization || !['owner','admin'].includes(organization.role))return;
    if(!providerToken)throw new Error('Đăng nhập lại Google để đồng bộ quyền Drive.');
    try {
      const checked=result=>{if(result.error)throw result.error;return result.data||[];};
      const files=fileId?[{google_drive_file_id:fileId,parent_folder_id:folderUid}]:checked(await supabase.from('documents_index').select('google_drive_file_id,parent_folder_id').eq('organization_id',organization.id).eq('user_id',currentUser.id).not('google_drive_file_id','is',null));
      for(const file of files){
        const driveId=file.google_drive_file_id;
        const desired=checked(await supabase.rpc('dochub_drive_recipients',{p_organization_id:organization.id,p_folder_uid:file.parent_folder_id}));
        const grants=checked(await supabase.from('drive_permission_links').select('*').eq('organization_id',organization.id).eq('drive_file_id',driveId));
        const live=await window.DocHubDrive.listPermissions(providerToken,driveId);
        const base=()=>supabase.from('drive_permission_links');
        for(const recipient of desired){
          if(recipient.email.toLowerCase()===currentUser.email?.toLowerCase())continue;
          const grant=grants.find(g=>g.email===recipient.email);
          const existing=live.find(p=>p.type==='user'&&p.emailAddress?.toLowerCase()===recipient.email);
          if(existing?.role==='owner')continue;
          if(existing&&!grant)throw new Error('Tệp có quyền Drive cấp ngoài DocHub cho '+recipient.email+'. Cần đối soát trước khi đồng bộ.');
          if(existing&&grant&&existing.id!==grant.permission_id)throw new Error('Quyền Drive đã thay đổi ngoài DocHub. Cần đối soát trước khi cập nhật.');
          const permission=await window.DocHubDrive.setUserPermission(providerToken,driveId,recipient.email,recipient.role,existing?.id||null);
          checked(await base().upsert({organization_id:organization.id,drive_file_id:driveId,email:recipient.email,permission_id:permission.id,role:recipient.role}));
        }
        for(const grant of grants){
          if(desired.some(r=>r.email===grant.email))continue;
          const existing=live.find(p=>p.id===grant.permission_id);
          if(existing && existing.role!=='owner')await window.DocHubDrive.removePermission(providerToken,driveId,grant.permission_id);
          checked(await base().delete().eq('organization_id',organization.id).eq('drive_file_id',driveId).eq('email',grant.email));
        }
      }
    } catch (syncErr) {
      handleDriveAuthError(syncErr);
      throw syncErr;
    }
  };
  api.getAsset = async (id, parentFolderId = 'all') => {
    await api.ready;
    // 1. Kiểm tra L1 cache IndexedDB cục bộ của người dùng (0ms load time)
    const cached = await cacheGet('assets', userCacheKey(id));
    if (cached) return cached;

    // The organization endpoint checks membership and the document's real folder
    // on every request. Avoid a duplicate RPC using the caller's folder hint.
    if(organizationBackend){
      const res = await backend('asset&id='+encodeURIComponent(id));
      const blob = await res.blob();
      if(blob) await cacheSet('assets', userCacheKey(id), blob);
      return blob;
    }
    await api.requirePermission(parentFolderId, 'read');
    // 2. Nếu không có trong cache, tải từ Google Drive
    if (providerToken && window.DocHubDrive) {
      const meta = await getDriveMeta(id);
      if (meta?.driveId) {
        try {
          const blob = await window.DocHubDrive.downloadFileBlob(providerToken, meta.driveId);
          if (blob) {
            await cacheSet('assets', userCacheKey(id), blob);
            return blob;
          }
        } catch (e) {
          handleDriveAuthError(e);
          console.warn('Tải tệp từ Google Drive thất bại:', e);
        }
      }
    }
    return null;
  };

  /**
   * Tạo nguồn phát cùng miền cho video/audio Drive. Trình duyệt sẽ tự gửi các
   * yêu cầu Range; Service Worker chuyển tiếp chúng mà không tải toàn bộ tệp.
   */
  api.getAssetStream = async (id, parentFolderId = 'all', mime = 'application/octet-stream') => {
    await api.requirePermission(parentFolderId, 'read');
    if(organizationBackend){
      const {data}=await supabase.auth.getSession(),key=globalThis.crypto.randomUUID();
      const registered=await postStreamWorker({type:'DOCHUB_STREAM_REGISTER',key,fileId:id,googleToken:data.session.access_token,organizationId:organization.id,mime});
      return registered?{key,url:`/__dochub_drive_stream__/${key}/${encodeURIComponent(id)}`} :null;
    }
    if (!providerToken) return null;
    const meta = await getDriveMeta(id);
    if (!meta?.driveId) return null;
    const key = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const registered = await postStreamWorker({
      type: 'DOCHUB_STREAM_REGISTER',
      key,
      fileId: meta.driveId,
      googleToken: providerToken,
      mime: mime || meta.mime
    });
    if (!registered) return null;
    return {
      key,
      url: `/__dochub_drive_stream__/${encodeURIComponent(key)}/${encodeURIComponent(meta.name || id)}`
    };
  };

  api.releaseAssetStream = async key => {
    if (!key) return;
    await postStreamWorker({ type: 'DOCHUB_STREAM_RELEASE', key }).catch(() => {});
  };

  /**
   * Xóa tệp tài liệu
   */
  api.removeAsset = async (id, parentFolderId = 'all') => {
    await api.requirePermission(parentFolderId, 'delete');
    if(organizationBackend){
      await backend('document-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,trash:true})});
      await cacheDelete('assets', userCacheKey(id));
      await cacheDelete('meta', userCacheKey(id));
      return;
    }
    await cacheDelete('assets', userCacheKey(id));
    if (providerToken && window.DocHubDrive) {
      const meta = await cacheGet('meta', userCacheKey(id));
      if (meta?.driveId) {
        try {
          await window.DocHubDrive.deleteFile(providerToken, meta.driveId);
          await cacheDelete('meta', userCacheKey(id));
        } catch (driveErr) {
          handleDriveAuthError(driveErr);
          console.warn('Xóa tệp trên Drive thất bại:', driveErr);
        }
      }
    }
    if (currentUser && supabase) {
      let deletion = supabase.from('documents_index').delete().eq('doc_uid', id);
      deletion = organization?.id ? deletion.eq('organization_id', organization.id) : deletion.eq('user_id', currentUser.id);
      const { error } = await deletion;
      if (error) throw error;
    }
  };

  /**
   * Xóa thư mục vĩnh viễn khỏi tổ chức
   */
  api.removeFolder = async (folderUid) => {
    if (!currentUser || !supabase) return;
    if (!organization) await ensureOrganization();
    if (!organization?.id) return;
    try {
      await supabase.from('organization_folders').delete().eq('organization_id', organization.id).eq('folder_uid', folderUid);
    } catch (_) {}
  };

  /**
   * Đăng nhập Google và cấp quyền Google Drive
   */
  api.loginWithGoogle = async ({ reconnectDrive = false } = {}) => {
    if (!supabase) throw new Error('Máy chủ đám mây chưa sẵn sàng. Hãy kiểm tra kết nối mạng và cấu hình.');
    if (googleProviderEnabled === null) await checkGoogleProvider();
    if (googleProviderEnabled === false) {
      authStatus = 'configuration_required';
      authError = 'Hãy bật Google Provider và cấu hình OAuth Client ID/Secret trên hệ thống máy chủ trước.';
      emitAuth('CONFIGURATION_REQUIRED');
      throw new Error(authError);
    }
    authStatus = 'redirecting';
    authError = null;
    emitAuth('SIGN_IN_STARTED');
    const redirectUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          scopes: `${config.DRIVE_SCOPE} email profile`,
          queryParams: {
            access_type: 'offline',
            ...(reconnectDrive === true ? { prompt: 'consent' } : {})
          },
          redirectTo: redirectUrl,
          skipBrowserRedirect: false
        }
      });
      if (error) throw error;
      return data;
    } catch (err) {
      authStatus = currentUser ? 'authenticated' : 'signed_out';
      authError = err?.message || 'Đăng nhập Google thất bại.';
      emitAuth('SIGN_IN_ERROR');
      throw err;
    }
  };

  /**
   * Đăng xuất tài khoản
   */
  api.logout = async () => {
    if (!supabase) return;
    authStatus = 'signing_out';
    authError = null;
    emitAuth('SIGN_OUT_STARTED');
    await api.flush();
    sessionStorage.removeItem('dochub_google_token');
    sessionStorage.removeItem('dochub_google_token_time');
    localStorage.removeItem('dochub_google_token');
    localStorage.removeItem('dochub_google_token_time');
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      authStatus = currentUser ? 'authenticated' : 'signed_out';
      authError = error.message || 'Đăng xuất thất bại.';
      emitAuth('SIGN_OUT_ERROR');
      throw error;
    }
    window.location.reload();
  };

  // Gán vào window
  window.DocHubAPI = api;
})();
