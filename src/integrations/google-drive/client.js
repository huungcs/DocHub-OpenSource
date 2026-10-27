/**
 * Google Drive API v3 Client
 * Xử lý các thao tác lưu trữ, đọc, xóa tài liệu trực tiếp trên Drive cá nhân của khách hàng
 */
window.DocHubDrive = (() => {
  'use strict';

  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
  const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

  async function request(url, token, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) {
      let msg = `Lỗi Google Drive API (${res.status})`;
      try {
        const errJson = await res.json();
        if (errJson.error?.message) msg = errJson.error.message;
      } catch (_) {}
      if (res.status === 401 || /invalid authentication credentials/i.test(msg)) {
        msg = 'Phiên kết nối Google Drive đã hết hạn. Vui lòng mở menu tài khoản → Kết nối lại Google Drive.';
      }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  /**
   * Tìm hoặc tự động tạo thư mục gốc của ứng dụng trên Drive khách hàng
   */
  async function getOrCreateAppFolder(token, folderName = 'DocHub - Dữ liệu cá nhân') {
    const q = encodeURIComponent(`mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false`);
    const searchRes = await request(`${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id,name)`, token);
    const searchData = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // Nếu chưa có, tạo mới
    const createRes = await request(`${DRIVE_API}/files`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Thư mục lưu trữ tự động của DocHub'
      })
    });
    const folder = await createRes.json();
    return folder.id;
  }

  function abortError() {
    const error = new Error('Đã hủy tải tệp lên.');
    error.name = 'AbortError';
    return error;
  }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    });
  }

  function uploadChunk(sessionUrl, token, chunk, start, total, mimeType, onProgress, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const xhr = new XMLHttpRequest();
      const end = start + chunk.size - 1;
      const onAbort = () => xhr.abort();
      xhr.open('PUT', sessionUrl);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', mimeType);
      xhr.setRequestHeader('Content-Range', total === 0 ? 'bytes */0' : `bytes ${start}-${end}/${total}`);
      xhr.upload.onprogress = event => {
        const loaded = Math.min(total, start + event.loaded);
        onProgress?.({ phase: 'uploading', loaded, total, percent: Math.round(loaded / total * 100) });
      };
      xhr.onload = () => {
        signal?.removeEventListener('abort', onAbort);
        if (xhr.status === 200 || xhr.status === 201) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (_) { reject(new Error('Google Drive trả về dữ liệu không hợp lệ.')); }
        } else if (xhr.status === 308) {
          resolve(null);
        } else {
          let message=`Lỗi Google Drive API (${xhr.status || 'mạng'})`;
          try { message=JSON.parse(xhr.responseText).error?.message||message; } catch (_) {}
          if(xhr.status===401)message='Phiên kết nối Google Drive đã hết hạn. Vui lòng mở menu tài khoản → Kết nối lại Google Drive.';
          if(/invalid authentication credentials/i.test(message))message='Phiên kết nối Google Drive đã hết hạn. Vui lòng mở menu tài khoản → Kết nối lại Google Drive.';
          const error=new Error(message);error.status=xhr.status;reject(error);
        }
      };
      xhr.onerror = () => {
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('Mất kết nối khi đang tải lên Google Drive.'));
      };
      xhr.onabort = () => {
        signal?.removeEventListener('abort', onAbort);
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      xhr.send(chunk);
    });
  }

  /**
   * Tải tiếp nối theo khối. Người dùng nhận được tiến trình thật và mỗi khối
   * có thể thử lại mà không phải gửi lại toàn bộ tệp.
   */
  async function uploadFile(token, folderId, fileBlob, fileName, mimeType = 'application/octet-stream', options = {}) {
    const { onProgress, signal } = options;
    const metadata = {
      name: fileName,
      mimeType: mimeType || 'application/octet-stream',
      parents: folderId ? [folderId] : []
    };
    if (signal?.aborted) throw abortError();
    onProgress?.({ phase: 'preparing', loaded: 0, total: fileBlob.size, percent: 0 });
    const initResponse = await request(`${UPLOAD_API}/files?uploadType=resumable&fields=id,name,size,mimeType,webViewLink`, token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileBlob.size)
      },
      body: JSON.stringify(metadata),
      signal
    });
    const sessionUrl = initResponse.headers.get('Location');
    if (!sessionUrl) throw new Error('Google Drive không tạo được phiên tải tiếp nối.');

    if (fileBlob.size === 0) {
      const result = await uploadChunk(sessionUrl, token, fileBlob, 0, 0, mimeType, onProgress, signal);
      onProgress?.({ phase: 'complete', loaded: 0, total: 0, percent: 100 });
      return result;
    }

    let result = null;
    for (let start = 0; start < fileBlob.size; start += UPLOAD_CHUNK_SIZE) {
      const chunk = fileBlob.slice(start, Math.min(fileBlob.size, start + UPLOAD_CHUNK_SIZE));
      let attempt = 0;
      while (true) {
        try {
          result = await uploadChunk(sessionUrl, token, chunk, start, fileBlob.size, mimeType, onProgress, signal);
          break;
        } catch (error) {
          if (error.name === 'AbortError' || [400,401,403,404].includes(error.status) || attempt >= 2) throw error;
          attempt++;
          onProgress?.({
            phase: 'retrying', loaded: start, total: fileBlob.size,
            percent: Math.round(start / fileBlob.size * 100), attempt
          });
          await wait(700 * (2 ** (attempt - 1)), signal);
        }
      }
      const loaded = Math.min(fileBlob.size, start + chunk.size);
      onProgress?.({ phase: result ? 'complete' : 'uploading', loaded, total: fileBlob.size, percent: Math.round(loaded / fileBlob.size * 100) });
    }
    if (!result) throw new Error('Google Drive chưa xác nhận tệp đã tải xong.');
    return result;
  }

  /**
   * Đọc/tải nội dung nhị phân (Blob) của tệp từ Google Drive
   */
  async function downloadFileBlob(token, fileId) {
    const res = await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, token);
    return await res.blob();
  }

  /**
   * Xóa tệp trên Google Drive
   */
  async function deleteFile(token, fileId) {
    try {
      await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, token, { method: 'DELETE' });
      return true;
    } catch (e) {
      console.warn('Xóa file Drive thất bại:', e);
      return false;
    }
  }

  async function listPermissions(token,fileId) {
    const result=[];let pageToken='';
    do {
      const response=await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?fields=nextPageToken,permissions(id,type,emailAddress,role)&supportsAllDrives=true${pageToken?'&pageToken='+encodeURIComponent(pageToken):''}`,token);
      const data=await response.json();result.push(...(data.permissions||[]));pageToken=data.nextPageToken||'';
    } while(pageToken);
    return result;
  }
  async function setUserPermission(token,fileId,email,role,permissionId=null) {
    if(!['reader','writer'].includes(role)||!email||!email.includes('@'))throw new Error('Quyền Drive không hợp lệ.');
    const base=`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions`;
    const response=await request(permissionId?`${base}/${encodeURIComponent(permissionId)}?supportsAllDrives=true`:`${base}?supportsAllDrives=true&sendNotificationEmail=false&fields=id`,token,{
      method:permissionId?'PATCH':'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(permissionId?{role}:{type:'user',emailAddress:email,role})
    });
    return response.json();
  }
  async function removePermission(token,fileId,permissionId) {
    await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`,token,{method:'DELETE'});
  }
  async function getOrCreateMirroredFolder(token,organizationId,folderUid,name,parentId=null) {
    const literal=value=>String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const q=`mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='dochub_org' and value='${literal(organizationId)}' } and appProperties has { key='dochub_folder' and value='${literal(folderUid)}' }`;
    const response=await request(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)&spaces=drive`,token);
    const files=(await response.json()).files||[];
    if(files.length>1)throw new Error('Có nhiều thư mục Drive cùng ánh xạ. Cần đối soát trước khi tiếp tục.');
    if(files[0])return files[0];
    return (await request(`${DRIVE_API}/files?fields=id,name,parents`,token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType:'application/vnd.google-apps.folder',parents:parentId?[parentId]:undefined,appProperties:{dochub_org:organizationId,dochub_folder:folderUid}})})).json();
  }
  async function reconcileFolder(token,fileId,name,parentId=null) {
    const meta=await (await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,parents,trashed`,token)).json();
    if(meta.trashed)throw new Error('Thư mục Drive đã ở thùng rác. Khôi phục trước khi đồng bộ.');
    const move=parentId&&!(meta.parents||[]).includes(parentId);
    if(meta.name===name&&!move)return meta;
    const params=new URLSearchParams({fields:'id,name,parents'});
    if(move){params.set('addParents',parentId);if(meta.parents?.length)params.set('removeParents',meta.parents.join(','));}
    return (await request(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params}`,token,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})).json();
  }
  return {
    getOrCreateMirroredFolder,reconcileFolder,
    listPermissions,setUserPermission,removePermission,
    getOrCreateAppFolder,
    uploadFile,
    downloadFileBlob,
    deleteFile
  };
})();
