const DEMO_FOLDER_UIDS = [
  'board','board-docs','executive','business','business-plan','customers',
  'admin','salary','salary-forms','allowance','discipline','administration',
  'finance','sales-policy','finance-reports','hr','recruitment','training',
  'employee-records','processes','production','admin-processes','archive','supplier-contracts'
];

'use strict';
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const fail=(status,message)=>Object.assign(new Error(message),{status});
function documentExtension(ext,mime,name=''){
 const clean=typeof ext==='string'?ext.trim().toLowerCase():'';
 if(/^[a-z0-9]{1,24}$/.test(clean))return clean;
 const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','application/pdf':'pdf','video/mp4':'mp4','text/plain':'txt','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx'};
 if(types[mime])return types[mime];
 return /\.([a-z0-9]{1,24})$/i.exec(name)?.[1].toLowerCase()||'';
}
function cleanDocumentName(name,ext){
 if(typeof name!=='string')throw fail(400,'Tên tài liệu không hợp lệ.');
 let value=name.trim();
 if(!value||value.length>200||/[\\/\u0000-\u001f]/.test(value))throw fail(400,'Tên tài liệu không hợp lệ.');
 const suffix=ext?'.'+ext.toLowerCase():'';
 // The database stores the base name; remove a repeated extension supplied by
 // older clients so Drive cannot become "report.pdf.pdf".
 if(suffix)while(value.toLowerCase().endsWith(suffix)){value=value.slice(0,-suffix.length).trim();}
 if(!value)throw fail(400,'Tên tài liệu không hợp lệ.');
 return value;
}
function validFolderUid(value){
 return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
}
function seal(value,key,context){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',crypto.createHash('sha256').update(key).digest(),iv);
 cipher.setAAD(Buffer.from(context));const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
}
function unseal(value,key,context){
 const data=Buffer.from(value,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(key).digest(),data.subarray(0,12));
 cipher.setAAD(Buffer.from(context));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString();
}
async function body(req){
 if(req.body){if(typeof req.body==='object')return req.body;return JSON.parse(req.body);}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw fail(413,'Yêu cầu quá lớn.');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw fail(400,'Dữ liệu không hợp lệ.');}
}
function cleanEnv(val){
 return typeof val==='string'?val.replace(/\\r|\\n|[\r\n]/g,'').trim().replace(/^['"\\]+|['"\\]+$/g,'').trim():'';
}
function createApi(env=process.env,fetcher=fetch,logger=console){
 const base=cleanEnv(env.SUPABASE_URL).replace(/\/$/,''),service=cleanEnv(env.SUPABASE_SERVICE_ROLE_KEY),key=cleanEnv(env.DOCHUB_TOKEN_KEY)||service;
 const googleClientId=cleanEnv(env.GOOGLE_OAUTH_CLIENT_ID),googleClientSecret=cleanEnv(env.GOOGLE_OAUTH_CLIENT_SECRET);
 const authCache=new Map(),driveTokenCache=new Map();
 async function jsonFetch(url,options){
  const stage=url.includes('/auth/v1/')?'supabase-auth':url.includes('/rest/v1/')?'supabase-database':url.includes('oauth2.googleapis.com')?'google-token':'google-api';
  let r;
  try{r=await fetcher(url,{...options,signal:AbortSignal.timeout(30000)});}
  catch(cause){const timeout=['TimeoutError','AbortError'].includes(cause.name);throw Object.assign(fail(timeout?504:502,timeout?'Dịch vụ lưu trữ phản hồi quá chậm.':'Không kết nối được dịch vụ lưu trữ.'),{diagnostic:{stage,code:timeout?'UPSTREAM_TIMEOUT':'UPSTREAM_CONNECTION_FAILED'}});}
  if(!r.ok){let payload;try{payload=await r.json();}catch{}const known=new Set(['42P01','42501','PGRST205','PGRST301','PGRST302','invalid_grant','invalid_client']);const upstreamCode=payload?.code||payload?.error;
   throw Object.assign(fail(r.status===401?401:502,'Dịch vụ lưu trữ chưa sẵn sàng ('+r.status+').'),{diagnostic:{stage,code:known.has(upstreamCode)?upstreamCode:'UPSTREAM_HTTP_ERROR',upstreamStatus:r.status}});
  }
  if(r.status===204)return null;
  try{return await r.json();}catch{throw Object.assign(fail(502,'Dịch vụ lưu trữ trả về dữ liệu không hợp lệ.'),{diagnostic:{stage,code:'UPSTREAM_INVALID_JSON'}});}
 }
 const db=(path,options={},token=service)=>jsonFetch(`${base}/rest/v1/${path}`,{...options,headers:{apikey:service,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation',...options.headers}});
 const rpc=(name,args,token)=>db('rpc/'+name,{method:'POST',body:JSON.stringify(args)},token);
 async function authenticate(req,url){
  if(!base||!service)throw fail(503,'Máy chủ chưa cấu hình kết nối tổ chức.');
  try{const target=new URL(base);if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error();}catch{throw Object.assign(fail(503,'SUPABASE_URL trên máy chủ không hợp lệ.'),{diagnostic:{stage:'configuration',code:'INVALID_SUPABASE_URL'}});}
  const bearer=/^Bearer (.+)$/i.exec(req.headers.authorization||'')?.[1];if(!bearer)throw fail(401,'Vui lòng đăng nhập.');
  const org=url.searchParams.get('organization');if(!/^[0-9a-f-]{36}$/i.test(org||''))throw fail(400,'Thiếu tổ chức hợp lệ.');
  const cacheKey=crypto.createHash('sha256').update(bearer+':'+org).digest('hex');
  const cachedAuth=authCache.get(cacheKey);if(cachedAuth&&cachedAuth.expiresAt>Date.now())return cachedAuth.val;
  const user=await jsonFetch(`${base}/auth/v1/user`,{headers:{apikey:service,Authorization:`Bearer ${bearer}`}});
  const members=await db(`organization_members?organization_id=eq.${org}&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&select=*`);
  if(members.length!==1)throw fail(403,'Bạn không thuộc không gian này.');
  const organizations=await db(`organizations?id=eq.${org}&select=*`);if(!organizations[0])throw fail(404,'Không tìm thấy tổ chức.');
  const authObj={org,user,bearer,member:members[0],organization:organizations[0]};
  if(authCache.size>200){const now=Date.now();for(const [k,v] of authCache)if(v.expiresAt<=now)authCache.delete(k);if(authCache.size>200)authCache.clear();}
  authCache.set(cacheKey,{val:authObj,expiresAt:Date.now()+60000});
  return authObj;
 }
 async function allowed(c,folder,action){if(!await rpc('dochub_can_folder_action',{p_organization_id:c.org,p_folder_uid:folder,p_action:action,p_user_id:c.user.id},c.bearer))throw fail(403,'Bạn không có quyền thực hiện thao tác trong thư mục này.');}
 async function refresh(refreshToken){return jsonFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken,client_id:googleClientId,client_secret:googleClientSecret})});}
 async function ownerToken(c,req){
  const cached=driveTokenCache.get(c.org);
  if(cached&&cached.expiresAt>Date.now())return cached.token;
  const headerToken=typeof req?.headers?.['x-google-access-token']==='string'?req.headers['x-google-access-token'].trim():'';
  if(headerToken&&headerToken.length>20&&headerToken.length<2048){
    driveTokenCache.set(c.org,{token:headerToken,expiresAt:Date.now()+50*60*1000});
    return headerToken;
  }
  const rows=await db(`organization_drive_connections?organization_id=eq.${c.org}&select=*`);
  if(!rows[0]||rows[0].owner_id!==c.organization.owner_id)throw fail(409,'Chủ sở hữu cần kết nối kho Drive doanh nghiệp.');
  try{
    const tokenData=await refresh(unseal(rows[0].encrypted_refresh_token,key,c.org));
    const token=tokenData.access_token;
    const ttl=Math.min((tokenData.expires_in||3600)-300,3000)*1000;
    driveTokenCache.set(c.org,{token,expiresAt:Date.now()+Math.max(ttl,60000)});
    return token;
  }catch(refreshErr){
    if(headerToken){
      driveTokenCache.set(c.org,{token:headerToken,expiresAt:Date.now()+50*60*1000});
      return headerToken;
    }
    throw refreshErr;
  }
 }
 async function document(c,id,action,{includeDeleted=false}={}){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id||''))throw fail(400,'Tệp không hợp lệ.');
  const rows=await db(`documents_index?organization_id=eq.${c.org}&doc_uid=eq.${id}&select=*`);
  if(rows.length!==1||(!includeDeleted&&rows[0].deleted_at))throw fail(404,'Không tìm thấy tài liệu.');
  await allowed(c,rows[0].parent_folder_id,action);return rows[0];
 }
 function browserOrigin(req,clientOrigin=null){
  const candidates=[
    clientOrigin,
    typeof req?.headers?.origin==='string'?req.headers.origin.trim():null,
    typeof req?.headers?.referer==='string'?req.headers.referer.trim():null,
    typeof req?.headers?.['x-forwarded-host']==='string'?`https://${req.headers['x-forwarded-host'].trim()}`:null,
    typeof req?.headers?.host==='string'?`https://${req.headers.host.trim()}`:null,
    'https://your-domain.com',
    'https://your-app.vercel.app'
  ];
  for(const raw of candidates){
    if(!raw||typeof raw!=='string')continue;
    try{
      const parsed=new URL(raw);
      if(['https:','http:'].includes(parsed.protocol)&&parsed.origin)return parsed.origin;
    }catch(_){}
  }
  return 'https://your-domain.com';
 }
 async function completeUpload(c,s,uploadId,metadata){
  if(!metadata?.id)throw fail(502,'Drive chưa xác nhận tệp.');
  const actualBytes=Number(metadata.size);
  if(Number.isFinite(actualBytes)&&actualBytes!==Number(s.bytes))throw fail(502,'Dung lượng tệp trên Drive không khớp với tệp đã chọn.');
  await db('documents_index?on_conflict=user_id,doc_uid',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({organization_id:c.org,user_id:c.user.id,doc_uid:s.doc_uid,parent_folder_id:s.folder_uid,name:s.name.replace(new RegExp('\\.'+s.ext.replace(/[^a-z0-9]/gi,'')+'$','i'),''),ext:s.ext,bytes:Number.isFinite(actualBytes)?actualBytes:s.bytes,mime_type:s.mime,google_drive_file_id:metadata.id})});
  await db(`organization_uploads?id=eq.${uploadId}`,{method:'DELETE'});
  return {complete:true,id:metadata.id};
 }
 async function uploadSession(c,id,{checkPermission=true}={}){
  if(!/^[0-9a-f-]{36}$/i.test(id||''))throw fail(400,'Phiên tải không hợp lệ.');
  const sessions=await db(`organization_uploads?id=eq.${id}&organization_id=eq.${c.org}&user_id=eq.${c.user.id}&select=*`),session=sessions[0];
  if(!session||Date.parse(session.expires_at)<Date.now())throw fail(410,'Phiên tải đã hết hạn. Vui lòng thử lại để tạo phiên mới.');
  if(checkPermission)await allowed(c,session.folder_uid,'create');
  return session;
 }
 async function checkUploadStatus(c,session,id){
  const uploadUrl=unseal(session.encrypted_url,key,id);
  const response=await fetcher(uploadUrl,{method:'PUT',headers:{'Content-Range':`bytes */${session.bytes}`},signal:AbortSignal.timeout(15000)}).catch(cause=>{
   const timeout=['TimeoutError','AbortError'].includes(cause?.name);throw fail(timeout?504:502,timeout?'Drive phản hồi quá chậm khi kiểm tra phiên tải.':'Không kiểm tra được phiên tải trên Drive.');
  });
  if(response.status===308)return {complete:false,range:response.headers.get('range')};
  if(response.ok)return completeUpload(c,session,id,await response.json().catch(()=>({})));
  if([404,410].includes(response.status))throw fail(410,'Phiên tải Drive đã hết hạn. Vui lòng thử lại.');
  throw fail(502,'Drive chưa xác nhận trạng thái phiên tải.');
 }
 async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const url=new URL(req.url,'http://localhost'),c=await authenticate(req,url),action=url.searchParams.get('action');let result;
   if(action==='status'&&req.method==='GET'){
    const rows=await db(`organization_drive_connections?organization_id=eq.${c.org}&select=owner_id`);result={connected:rows[0]?.owner_id===c.organization.owner_id};
   }else if(action==='invite-code'&&req.method==='GET'){
    const rows=await db(`organizations?id=eq.${c.org}&select=invite_code`);result={inviteCode:rows[0]?.invite_code||null};
   }else if(action==='invite-reset'&&req.method==='POST'){
    if(!['owner','admin'].includes(c.member.organization_role))throw fail(403,'Chỉ quản trị viên mới được đặt lại mã mời.');
    const crypto=require('crypto');const newCode=crypto.randomBytes(6).toString('hex');
    await db(`organizations?id=eq.${c.org}`,{method:'PATCH',body:JSON.stringify({invite_code:newCode,updated_at:new Date().toISOString()})});
    result={inviteCode:newCode};
   }else if(action==='connect'&&req.method==='POST'){
    if(c.user.id!==c.organization.owner_id)throw fail(403,'Chỉ chủ sở hữu được kết nối kho Drive.');
    const input=await body(req);if(typeof input.refreshToken!=='string'||input.refreshToken.length>8192)throw fail(400,'Cần đăng nhập Google lại để cấp kết nối dài hạn.');
    const token=await refresh(input.refreshToken);
    const identity=await jsonFetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`}});
    if(!identity.email_verified||identity.email?.toLowerCase()!==c.user.email?.toLowerCase())throw fail(403,'Tài khoản Drive phải là chủ sở hữu đã đăng nhập.');
    await db('organization_drive_connections?on_conflict=organization_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({organization_id:c.org,owner_id:c.user.id,encrypted_refresh_token:seal(input.refreshToken,key,c.org),updated_at:new Date().toISOString()})});result={connected:true};
   }else if(action==='workspace'&&req.method==='GET'){
    // These reads are independent after authentication. Keep the user's RLS token
    // on both visibility queries; never cache permission-filtered results globally.
    const [rows,visible,docs]=await Promise.all([
     db(`user_workspaces?user_id=eq.${c.organization.owner_id}&select=state,revision`),
     db(`organization_folders?organization_id=eq.${c.org}&select=*`,{},c.bearer),
     db(`documents_index?organization_id=eq.${c.org}&select=*`,{},c.bearer)
    ]);const state=rows[0]?.state;
    if(!state){result={state:null};}else{
      const output=structuredClone(state),folders=(output.folders||[]).filter(f=>!DEMO_FOLDER_UIDS.includes(f.id));
      for(const vf of visible){
        if(DEMO_FOLDER_UIDS.includes(vf.folder_uid)) continue;
        if(!folders.some(f=>f.id===vf.folder_uid)){
          folders.push({id:vf.folder_uid,parentId:vf.parent_uid,name:vf.name,description:vf.description||'',kind:'folder',inherit:vf.inherit_permissions!==false,deletedAt:vf.deleted_at||null});
        }
      }
      const ids=new Set(visible.map(f=>f.folder_uid));
      const ancestors=new Set(['all']),folderById=new Map(folders.map(f=>[f.id,f]));
      for(const f of folders.filter(f=>ids.has(f.id))){let cursor=f,seen=new Set();while(cursor&&!seen.has(cursor.id)){seen.add(cursor.id);ancestors.add(cursor.id);cursor=folderById.get(cursor.parentId);}}
      output.folders=folders.filter(f=>ancestors.has(f.id)).map(f=>ids.has(f.id)?f:{id:f.id,parentId:f.parentId,name:f.name,kind:'folder',inherit:false,deletedAt:null});
      const serverDocIds=new Set(docs.map(d=>d.doc_uid));
      const deviceDocs=(output.documents||[]).filter(d=>d.assetStorage==='device'&&!serverDocIds.has(d.id)&&!d.sample&&d.source!=='sample'&&d.source!=='bundled'&&!DEMO_FOLDER_UIDS.includes(d.parentId));
      output.documents=[...deviceDocs];
      for(const d of docs){
        if(DEMO_FOLDER_UIDS.includes(d.parent_folder_id)) continue;
        output.documents.push({id:d.doc_uid,parentId:d.parent_folder_id,name:d.name,description:d.description||'',ext:documentExtension(d.ext,d.mime_type,d.name),bytes:d.bytes,mime:d.mime_type,kind:'file',ownerId:'u1',source:'upload',assetStorage:'server',createdAt:d.created_at,updatedAt:d.updated_at,deletedAt:d.deleted_at||null});
      }
      output.acl=(output.acl||[]).filter(a=>!DEMO_FOLDER_UIDS.includes(a.resourceId));
      if(!['owner','admin'].includes(c.member.organization_role)){output.logs=[];output.acl=[];output.groups=[];output.users=[{id:'u1',name:c.user.user_metadata?.full_name||c.user.email,email:c.user.email,groupIds:[],active:true}];}
      output.preferences={...output.preferences,driveSharingEnabled:false};result={state:output,revision:rows[0].revision};
    }
   }else if(action==='document-update'&&req.method==='POST'){
    const input=await body(req);
    const isTrash=input.trash===true;
    const isRestore=input.deletedAt===null||input.deletedAt===false;
    if(input.trash!==undefined&&typeof input.trash!=='boolean')throw fail(400,'Trạng thái xóa không hợp lệ.');
    if(input.deletedAt!==undefined&&input.deletedAt!==null&&input.deletedAt!==false)throw fail(400,'Trạng thái khôi phục không hợp lệ.');
    if(isTrash&&isRestore)throw fail(400,'Yêu cầu cập nhật không hợp lệ.');
    const doc=await document(c,input.id,isTrash?'delete':isRestore?'create':'edit',{includeDeleted:isRestore});
    if(isTrash){
      const token=await ownerToken(c,req);await jsonFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.google_drive_file_id)}`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({trashed:true})});
      await db(`documents_index?id=eq.${doc.id}`,{method:'PATCH',body:JSON.stringify({deleted_at:new Date().toISOString()})});result={ok:true};
    }else{
      if(typeof input.description!=='string'||input.description.length>5000||!validFolderUid(input.parentId))throw fail(400,'Thông tin tài liệu không hợp lệ.');
      const name=cleanDocumentName(input.name,doc.ext);
      const token=await ownerToken(c,req);let query='';
      if(input.parentId!==doc.parent_folder_id){
        await allowed(c,doc.parent_folder_id,'move');await allowed(c,input.parentId,'create');
        const mapping=await db(`organization_drive_folders?organization_id=eq.${c.org}&folder_uid=eq.${encodeURIComponent(input.parentId)}&select=drive_folder_id`);if(!mapping[0])throw fail(409,'Thư mục đích chưa được đồng bộ vào Drive.');
        const original=await jsonFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.google_drive_file_id)}?fields=parents`,{headers:{Authorization:`Bearer ${token}`}});
        query='?'+new URLSearchParams({addParents:mapping[0].drive_folder_id,...(original.parents?.length?{removeParents:original.parents.join(',')}:{})});
      }
      await jsonFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.google_drive_file_id)}${query}`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:name+(doc.ext?'.'+doc.ext:''),description:input.description, ...(isRestore?{trashed:false}:{})})});
      await db(`documents_index?id=eq.${doc.id}`,{method:'PATCH',body:JSON.stringify({name,description:input.description,parent_folder_id:input.parentId,deleted_at:null,updated_at:new Date().toISOString()})});result={ok:true};
    }
   }else if(action==='upload-start'&&req.method==='POST'){
    const input=await body(req);
    if(!/^[a-zA-Z0-9_-]{1,100}$/.test(input.id||'')||typeof input.name!=='string'||!input.name.trim()||input.name.length>200||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>250*1024*1024)throw fail(400,'Thông tin tệp không hợp lệ (tối đa 250 MB).');
    await allowed(c,input.folder,'create');
    const existing=await db(`documents_index?organization_id=eq.${c.org}&doc_uid=eq.${input.id}&select=id`);if(existing.length)throw fail(409,'Tệp đã tồn tại.');
    const mappings=await db(`organization_drive_folders?organization_id=eq.${c.org}&folder_uid=eq.${encodeURIComponent(input.folder)}&select=drive_folder_id`);
    let driveFolderId=mappings[0]?.drive_folder_id;
    const token=await ownerToken(c,req);
    if(!driveFolderId){
      const folders=await db(`organization_folders?organization_id=eq.${c.org}&folder_uid=eq.${encodeURIComponent(input.folder)}&select=*`);
      if(folders[0]){
        let parentDriveId=null;
        if(folders[0].parent_uid){
          const pMaps=await db(`organization_drive_folders?organization_id=eq.${c.org}&folder_uid=eq.${encodeURIComponent(folders[0].parent_uid)}&select=drive_folder_id`);
          parentDriveId=pMaps[0]?.drive_folder_id;
        }
        const rootMaps=await db(`organization_drive_folders?organization_id=eq.${c.org}&folder_uid=eq.all&select=drive_folder_id`);
        if(!parentDriveId)parentDriveId=rootMaps[0]?.drive_folder_id;
        if(parentDriveId||input.folder==='all'){
          const fName=input.folder==='all'?`DocHub — ${c.organization.name||'Không gian'}`:folders[0].name;
          const created=await jsonFetch('https://www.googleapis.com/drive/v3/files?fields=id',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:fName,mimeType:'application/vnd.google-apps.folder',...(parentDriveId?{parents:[parentDriveId]}:{})})});
          if(created?.id){
            driveFolderId=created.id;
            await db('organization_drive_folders?on_conflict=organization_id,folder_uid',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({organization_id:c.org,folder_uid:input.folder,drive_folder_id:driveFolderId})});
          }
        }
      }
    }
    if(!driveFolderId)throw fail(409,'Chủ sở hữu cần đồng bộ thư mục này vào kho Drive.');
    const mime=typeof input.mime==='string'&&input.mime.length<150?input.mime:'application/octet-stream';
    const origin=browserOrigin(req,input.origin);
    const response=await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Upload-Content-Length':String(input.bytes),'X-Upload-Content-Type':mime,...(origin?{Origin:origin}:{})},body:JSON.stringify({name:input.name,mimeType:mime,parents:[driveFolderId]}),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw fail(502,'Không tạo được phiên tải vào kho Drive.');
    const location=response.headers.get('location');if(!location||new URL(location).hostname!=='www.googleapis.com')throw fail(502,'Phiên tải Drive không hợp lệ.');
    const id=crypto.randomUUID();await db('organization_uploads',{method:'POST',body:JSON.stringify({id,organization_id:c.org,user_id:c.user.id,doc_uid:input.id,folder_uid:input.folder,name:input.name,ext:documentExtension(input.ext,mime,input.name),mime,bytes:input.bytes,encrypted_url:seal(location,key,id),expires_at:new Date(Date.now()+24*60*60*1000).toISOString()})});result={id,uploadUrl:location,chunkSize:8*1024*1024};
   }else if(action==='upload-finish'&&req.method==='POST'){
    const input=await body(req);
    const id=input.upload,s=await uploadSession(c,id);
    // The resumable-session URL is the server-issued proof that identifies the
    // Drive object. Never trust a Drive file ID supplied by the browser here:
    // it could refer to another accessible file with the same size.
    const status=await checkUploadStatus(c,s,id);
    if(!status.complete)throw fail(409,'Tệp chưa tải xong vào Google Drive. Vui lòng tiếp tục tải lên trước khi hoàn tất.');
    result=status;
   }else if(action==='upload-status'&&req.method==='GET'){
    const id=url.searchParams.get('upload'),s=await uploadSession(c,id);
    result=await checkUploadStatus(c,s,id);
   }else if(action==='upload-chunk'&&req.method==='PUT'){
    const id=url.searchParams.get('upload'),s=await uploadSession(c,id,{checkPermission:false});
    const parts=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers['content-range']||'');
    if(!parts||Number(parts[3])!==Number(s.bytes)||Number(parts[2])>=Number(s.bytes)||Number(parts[2])<Number(parts[1])||Number(parts[1])%262144!==0)throw fail(400,'Khoảng tải không hợp lệ.');
    let payload;if(Buffer.isBuffer(req.body))payload=req.body;else if(typeof req.body==='string')payload=Buffer.from(req.body,'latin1');else{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024)throw fail(413,'Khối tải vượt giới hạn.');chunks.push(chunk);}payload=Buffer.concat(chunks);}
    if(payload.length>10*1024*1024||payload.length!==Number(parts[2])-Number(parts[1])+1)throw fail(400,'Kích thước khối tải không hợp lệ.');
    const uploadUrl=unseal(s.encrypted_url,key,id);
    const response=await fetcher(uploadUrl,{method:'PUT',headers:{'Content-Type':s.mime,'Content-Range':req.headers['content-range']},body:payload,signal:AbortSignal.timeout(60000)});
    if(response.status===308){result={complete:false,range:response.headers.get('range')};}
    else if(response.ok){result=await completeUpload(c,s,id,await response.json().catch(()=>({})));
    }else{
     result=await checkUploadStatus(c,s,id);
    }
   }else if(action==='asset'&&['GET','HEAD'].includes(req.method)){
    const doc=await document(c,url.searchParams.get('id'),'read'),token=await ownerToken(c,req);
    const range=req.headers.range;if(range&&!/^bytes=\d*-\d*$/.test(range))throw fail(416,'Khoảng dữ liệu không hợp lệ.');
    const response=await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.google_drive_file_id)}?alt=media`,{headers:{Authorization:`Bearer ${token}`,...(range?{Range:range}:{})},signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw fail(response.status===404?404:502,'Không đọc được tệp từ kho doanh nghiệp.');
    res.statusCode=response.status;for(const h of ['content-type','content-length','content-range','accept-ranges'])if(response.headers.get(h))res.setHeader(h,response.headers.get(h));
    res.setHeader('Cache-Control','private, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('Content-Disposition','attachment');if(req.method==='HEAD'){response.body?.cancel();res.end();return;}await pipeline(Readable.fromWeb(response.body),res);return;
   }else{throw fail(404,'Chức năng chưa được cung cấp.');}
   res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result));
  }catch(error){const requestId=crypto.randomUUID();const status=error.status||500;
   if(status>=500||error.diagnostic)logger.error('DocHub organization API',JSON.stringify({requestId,status,...(error.diagnostic||{stage:'handler',code:'INTERNAL_ERROR'})}));
   if(res.headersSent){res.destroy();return;}res.statusCode=status;res.setHeader('X-DocHub-Request-Id',requestId);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.status?error.message:'Không xử lý được yêu cầu. Vui lòng thử lại.',requestId}));}
 }
 return handler;
}
module.exports={createApi,seal,unseal,documentExtension,cleanDocumentName,validFolderUid};
