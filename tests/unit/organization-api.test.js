const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createApi,seal,unseal,documentExtension}=require('../../src/server/organization-api');
test('Invalid legacy extensions never become document IDs in the workspace',()=>{
 assert.equal(documentExtension('doc-c4493418-dda8-4dee-9bbe-b714bc6a0e22','image/jpeg'),'jpg');
 assert.equal(documentExtension(' JPG ','image/jpeg'),'jpg');
 assert.equal(documentExtension(null,'unknown','report.xlsx'),'xlsx');
 assert.equal(documentExtension('invalid-id','unknown','filename'),'');
 assert.equal(documentExtension('x'.repeat(25),'application/pdf'),'pdf');
});
const org='11111111-1111-1111-1111-111111111111';
test('Workspace reads start concurrently and visibility queries retain user RLS',async()=>{
 const pending=[];let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async(url,options)=>{
  let data;
  if(url.includes('/auth/'))data={id:'owner'};
  else if(url.includes('organization_members'))data=[{organization_role:'owner'}];
  else if(url.includes('/organizations?'))data=[{owner_id:'owner'}];
  else {
   pending.push(url);
   if(!url.includes('user_workspaces'))assert.equal(options.headers.Authorization,'Bearer jwt');
   if(pending.length===3)release();
   await gate;
   data=url.includes('user_workspaces')?[{state:{folders:[],documents:[]},revision:2}]:[];
  }
  return {ok:true,status:200,json:async()=>data};
 });
 const res=response();
 await api(request('/api/organization?action=workspace&organization='+org,{authorization:'Bearer jwt'}),res);
 assert.equal(pending.length,3);assert.equal(res.data.revision,2);
});
test('Workspace excludes stale account files and returns only organization-indexed files',async()=>{
 const snapshot={folders:[{id:'all',parentId:null}],documents:[{id:'stale-id',parentId:'all',name:'same-name',assetStorage:'server'}],preferences:{}};
 const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async url=>{
  let data;
  if(url.includes('/auth/'))data={id:'owner'};
  else if(url.includes('organization_members'))data=[{organization_role:'owner'}];
  else if(url.includes('/organizations?'))data=[{owner_id:'owner'}];
  else if(url.includes('user_workspaces'))data=[{state:snapshot,revision:1}];
  else if(url.includes('organization_folders'))data=[{folder_uid:'all'}];
  else if(url.includes('documents_index')){assert.ok(url.includes('organization_id=eq.'+org));data=[{doc_uid:'indexed-id',parent_folder_id:'all',name:'same-name',ext:'doc-invalid-legacy-extension-longer-than-24',mime_type:'image/jpeg'}];}
  else assert.fail('Unexpected request');
  return {ok:true,status:200,json:async()=>data};
 });
 const res=response();await api(request('/api/organization?action=workspace&organization='+org,{authorization:'Bearer jwt'}),res);
 assert.deepEqual(res.data.state.documents.map(d=>d.id),['indexed-id']);
 assert.equal(res.data.state.documents[0].ext,'jpg');
 assert.equal(snapshot.documents[0].id,'stale-id','Original snapshot is preserved');
});
test('Network diagnostics correlate responses without leaking credentials',async()=>{
 const logs=[];const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'private-key'},async()=>{throw new Error('private-key Bearer secret-token');},{error:(...args)=>logs.push(args)});
 const res=response();await api(request('/api/organization?action=status&organization='+org,{authorization:'Bearer secret-token'}),res);
 assert.equal(res.statusCode,502);assert.equal(res.data.requestId,res.headers['X-DocHub-Request-Id']);
 assert.match(JSON.stringify(logs),/UPSTREAM_CONNECTION_FAILED/);
 assert.ok(!JSON.stringify([logs,res]).includes('private-key'));assert.ok(!JSON.stringify([logs,res]).includes('secret-token'));
});
test('Invalid server URL is rejected without attempting network access',async()=>{
 const api=createApi({SUPABASE_URL:'SUPABASE_URL=https://test',SUPABASE_SERVICE_ROLE_KEY:'key'},async()=>{assert.fail('Must not fetch');},{error:()=>{}});
 const res=response();await api(request('/api/organization?action=status&organization='+org,{authorization:'Bearer jwt'}),res);assert.equal(res.statusCode,503);
});
function request(url,headers={},method='GET',payload){const req=Readable.from([]);Object.assign(req,{url,headers,method,body:payload});return req;}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.data=JSON.parse(value);}};}
test('Owner credentials are authenticated encrypted and bound to one organization',()=>{
 const cipher=seal('secret-refresh-token','key',org);
 assert.equal(unseal(cipher,'key',org),'secret-refresh-token');
 assert.throws(()=>unseal(cipher,'key','another-org'));
 assert.throws(()=>unseal(cipher,'wrong-key',org));
 assert.ok(!cipher.includes('secret-refresh-token'));
});
test('API requires authentication before querying Drive',async()=>{
 let called=false;const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async()=>{called=true;throw Error();});
 const res=response();await api(request('/api/organization?action=asset&organization='+org),res);
 assert.equal(res.statusCode,401);assert.equal(called,false);
});
test('A nonmember cannot use the owner connection',async()=>{
 const urls=[];const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async(url)=>{urls.push(url);return {ok:true,status:200,json:async()=>url.includes('/auth/')?{id:'employee'}:[]};});
 const res=response();await api(request('/api/organization?action=status&organization='+org,{authorization:'Bearer jwt'}),res);
 assert.equal(res.statusCode,403);assert.equal(urls.length,2);
});
test('Denied folder reads never obtain the owner token or fetch bytes',async()=>{
 const urls=[];const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async(url)=>{
 urls.push(url);let data;
 if(url.includes('/auth/'))data={id:'employee'};
 else if(url.includes('organization_members'))data=[{organization_role:'member'}];
 else if(url.includes('/organizations?'))data=[{owner_id:'owner'}];
 else if(url.includes('documents_index'))data=[{parent_folder_id:'private',google_drive_file_id:'drive-id'}];
 else if(url.includes('rpc/'))data=false;
 else throw Error('Unexpected credential/Drive access');
 return {ok:true,status:200,json:async()=>data};});
 const res=response();await api(request('/api/organization?action=asset&organization='+org+'&id=doc-1',{authorization:'Bearer jwt'}),res);
 assert.equal(res.statusCode,403);assert.ok(!urls.some(u=>u.includes('connections')||u.includes('googleapis')));
});
test('upload-start returns direct uploadUrl and upload-finish verifies and indexes file',async()=>{
 const createdDocs=[];const deletedUploads=[];let resumableOrigin;
 const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service',GOOGLE_OAUTH_CLIENT_ID:'id',GOOGLE_OAUTH_CLIENT_SECRET:'sec'},async(url,opts={})=>{
  if(url.includes('/auth/v1/user'))return {ok:true,status:200,json:async()=>({id:'owner'})};
  if(url.includes('organization_members'))return {ok:true,status:200,json:async()=>([{organization_role:'owner'}])};
  if(url.includes('/organizations?'))return {ok:true,status:200,json:async()=>([{owner_id:'owner'}])};
  if(url.includes('rpc/dochub_can_folder_action'))return {ok:true,status:200,json:async()=>true};
  if(url.includes('documents_index?organization_id='))return {ok:true,status:200,json:async()=>[]};
  if(url.includes('organization_drive_folders'))return {ok:true,status:200,json:async()=>([{drive_folder_id:'drive-folder'}])};
  if(url.includes('organization_drive_connections'))return {ok:true,status:200,json:async()=>([{owner_id:'owner',encrypted_refresh_token:seal('rt','service',org)}])};
  if(url.includes('oauth2.googleapis.com/token'))return {ok:true,status:200,json:async()=>({access_token:'drive-token',expires_in:3600})};
  if(url.includes('upload/drive/v3/files?uploadType=resumable')){resumableOrigin=opts.headers.Origin;return {ok:true,status:200,headers:new Map([['location','https://www.googleapis.com/upload/session-123']])};}
  if(url.includes('organization_uploads?id=eq.')&&opts.method==='DELETE'){deletedUploads.push('11111111-1111-1111-1111-111111111111');return {ok:true,status:200,json:async()=>[]};}
  if(url==='https://www.googleapis.com/upload/session-123')return {ok:true,status:200,json:async()=>({id:'drive-file-123',size:1024})};
  if(url.includes('organization_uploads?id=eq.'))return {ok:true,status:200,json:async()=>([{id:'11111111-1111-1111-1111-111111111111',organization_id:org,user_id:'owner',doc_uid:'doc-1',folder_uid:'all',name:'test.pdf',ext:'pdf',bytes:1024,mime:'application/pdf',expires_at:new Date(Date.now()+60000).toISOString(),encrypted_url:seal('https://www.googleapis.com/upload/session-123','service','11111111-1111-1111-1111-111111111111')}])};
  if(url.includes('googleapis.com/drive/v3/files/drive-file-123'))return {ok:true,status:200,json:async()=>({id:'drive-file-123',name:'test.pdf',size:1024,trashed:false})};
  if(url.includes('documents_index?on_conflict=')){createdDocs.push(JSON.parse(opts.body));return {ok:true,status:200,json:async()=>[{id:1}]};}
  if(url.includes('organization_uploads')){return {ok:true,status:200,json:async()=>[]};}
  throw Error('Unexpected url: '+url);
 });
 const startReq=request('/api/organization?action=upload-start&organization='+org,{authorization:'Bearer jwt','content-type':'application/json',origin:'https://dochub.example'},'POST',JSON.stringify({id:'doc-1',folder:'all',name:'test.pdf',ext:'pdf',mime:'application/pdf',bytes:1024}));
 const startRes=response();
 await api(startReq,startRes);
 assert.equal(startRes.data.uploadUrl,'https://www.googleapis.com/upload/session-123');
 assert.equal(startRes.data.chunkSize,8*1024*1024);
 assert.equal(resumableOrigin,'https://dochub.example');

 const finishReq=request('/api/organization?action=upload-finish&organization='+org,{authorization:'Bearer jwt','content-type':'application/json'},'POST',JSON.stringify({upload:'11111111-1111-1111-1111-111111111111'}));
 const finishRes=response();
 await api(finishReq,finishRes);
 assert.equal(finishRes.data.complete,true);
 assert.equal(createdDocs.length,1);
 assert.equal(createdDocs[0].google_drive_file_id,'drive-file-123');
 assert.equal(deletedUploads.length,1);
});

test('upload-status rechecks folder permission and resumes at the Drive byte range',async()=>{
 const uploadId='22222222-2222-2222-2222-222222222222';let permissionChecks=0;
 const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service',GOOGLE_OAUTH_CLIENT_ID:'id',GOOGLE_OAUTH_CLIENT_SECRET:'sec'},async(url,opts={})=>{
  if(url.includes('/auth/v1/user'))return {ok:true,status:200,json:async()=>({id:'member'})};
  if(url.includes('organization_members'))return {ok:true,status:200,json:async()=>([{organization_role:'member'}])};
  if(url.includes('/organizations?'))return {ok:true,status:200,json:async()=>([{owner_id:'owner'}])};
  if(url.includes('rpc/dochub_can_folder_action')){permissionChecks++;return {ok:true,status:200,json:async()=>true};}
  if(url.includes('organization_uploads?id=eq.'))return {ok:true,status:200,json:async()=>([{id:uploadId,organization_id:org,user_id:'member',doc_uid:'doc-60mb',folder_uid:'all',name:'large.pdf',ext:'pdf',bytes:60*1024*1024,mime:'application/pdf',expires_at:new Date(Date.now()+60000).toISOString(),encrypted_url:seal('https://www.googleapis.com/upload/session-large','service',uploadId)}])};
  if(url.includes('organization_drive_connections'))return {ok:true,status:200,json:async()=>([{owner_id:'owner',encrypted_refresh_token:seal('rt','service',org)}])};
  if(url.includes('oauth2.googleapis.com/token'))return {ok:true,status:200,json:async()=>({access_token:'drive-token',expires_in:3600})};
  if(url==='https://www.googleapis.com/upload/session-large')return {ok:false,status:308,headers:new Map([['range','bytes=0-8388607']])};
  throw Error('Unexpected url: '+url);
 });
 const res=response();await api(request('/api/organization?action=upload-status&organization='+org+'&upload='+uploadId,{authorization:'Bearer jwt'}),res);
 assert.equal(res.statusCode,undefined);
 assert.deepEqual(res.data,{complete:false,range:'bytes=0-8388607'});
 assert.equal(permissionChecks,1);
});

test('document-update validates the document name and keeps Drive and index names canonical',async()=>{
 const driveUpdates=[],indexUpdates=[];
 const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service',GOOGLE_OAUTH_CLIENT_ID:'id',GOOGLE_OAUTH_CLIENT_SECRET:'sec'},async(url,opts={})=>{
  if(url.includes('/auth/v1/user'))return {ok:true,status:200,json:async()=>({id:'member'})};
  if(url.includes('organization_members'))return {ok:true,status:200,json:async()=>([{organization_role:'member'}])};
  if(url.includes('/organizations?'))return {ok:true,status:200,json:async()=>([{owner_id:'owner'}])};
  if(url.includes('documents_index?organization_id='))return {ok:true,status:200,json:async()=>([{id:7,parent_folder_id:'all',google_drive_file_id:'drive-doc',ext:'pdf'}])};
  if(url.includes('rpc/dochub_can_folder_action'))return {ok:true,status:200,json:async()=>true};
  if(url.includes('organization_drive_connections'))return {ok:true,status:200,json:async()=>([{owner_id:'owner',encrypted_refresh_token:seal('rt','service',org)}])};
  if(url.includes('oauth2.googleapis.com/token'))return {ok:true,status:200,json:async()=>({access_token:'drive-token',expires_in:3600})};
  if(url.includes('www.googleapis.com/drive/v3/files/drive-doc')){driveUpdates.push(JSON.parse(opts.body));return {ok:true,status:200,json:async()=>({})};}
  if(url.includes('documents_index?id=eq.7')){indexUpdates.push(JSON.parse(opts.body));return {ok:true,status:200,json:async()=>[]};}
  throw Error('Unexpected url: '+url);
 });
 const res=response();
 await api(request('/api/organization?action=document-update&organization='+org,{authorization:'Bearer jwt'},'POST',JSON.stringify({id:'doc-1',name:'Báo cáo.pdf',description:'Mô tả',parentId:'all'})),res);
 assert.deepEqual(res.data,{ok:true});
 assert.deepEqual(driveUpdates,[{name:'Báo cáo.pdf',description:'Mô tả'}]);
 assert.equal(indexUpdates[0].name,'Báo cáo');
 assert.equal(indexUpdates[0].deleted_at,null);

 const invalid=response();
 await api(request('/api/organization?action=document-update&organization='+org,{authorization:'Bearer jwt'},'POST',JSON.stringify({id:'doc-1',name:'../../bad',description:'',parentId:'all'})),invalid);
 assert.equal(invalid.statusCode,400);
 const invalidFolder=response();
 await api(request('/api/organization?action=document-update&organization='+org,{authorization:'Bearer jwt'},'POST',JSON.stringify({id:'doc-1',name:'Hợp lệ',description:'',parentId:'missing/folder'})),invalidFolder);
 assert.equal(invalidFolder.statusCode,400);
});

test('document-update restores a trashed document explicitly instead of treating deletedAt as a delete request',async()=>{
 const driveUpdates=[],indexUpdates=[];
 const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service',GOOGLE_OAUTH_CLIENT_ID:'id',GOOGLE_OAUTH_CLIENT_SECRET:'sec'},async(url,opts={})=>{
  if(url.includes('/auth/v1/user'))return {ok:true,status:200,json:async()=>({id:'member'})};
  if(url.includes('organization_members'))return {ok:true,status:200,json:async()=>([{organization_role:'member'}])};
  if(url.includes('/organizations?'))return {ok:true,status:200,json:async()=>([{owner_id:'owner'}])};
  if(url.includes('documents_index?organization_id='))return {ok:true,status:200,json:async()=>([{id:7,parent_folder_id:'all',google_drive_file_id:'drive-doc',ext:'pdf',deleted_at:'2026-01-01T00:00:00Z'}])};
  if(url.includes('rpc/dochub_can_folder_action'))return {ok:true,status:200,json:async()=>true};
  if(url.includes('organization_drive_connections'))return {ok:true,status:200,json:async()=>([{owner_id:'owner',encrypted_refresh_token:seal('rt','service',org)}])};
  if(url.includes('oauth2.googleapis.com/token'))return {ok:true,status:200,json:async()=>({access_token:'drive-token',expires_in:3600})};
  if(url.includes('www.googleapis.com/drive/v3/files/drive-doc')){driveUpdates.push(JSON.parse(opts.body));return {ok:true,status:200,json:async()=>({})};}
  if(url.includes('documents_index?id=eq.7')){indexUpdates.push(JSON.parse(opts.body));return {ok:true,status:200,json:async()=>[]};}
  throw Error('Unexpected url: '+url);
 });
 const res=response();
 await api(request('/api/organization?action=document-update&organization='+org,{authorization:'Bearer jwt'},'POST',JSON.stringify({id:'doc-1',name:'Khôi phục',description:'',parentId:'all',deletedAt:null})),res);
 assert.deepEqual(res.data,{ok:true});
 assert.deepEqual(driveUpdates,[{name:'Khôi phục.pdf',description:'',trashed:false}]);
 assert.equal(indexUpdates[0].deleted_at,null);
});

test('upload-finish accepts only the Drive object confirmed by its resumable session',async()=>{
 const uploadId='44444444-4444-4444-4444-444444444444';let indexed=0,metadataLookup=0;
 const session={id:uploadId,organization_id:org,user_id:'member',doc_uid:'doc-locked',folder_uid:'all',name:'locked.pdf',ext:'pdf',bytes:1024,mime:'application/pdf',expires_at:new Date(Date.now()+60000).toISOString(),encrypted_url:seal('https://www.googleapis.com/upload/session-locked','service',uploadId)};
 const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async(url,opts={})=>{
  if(url.includes('/auth/v1/user'))return {ok:true,status:200,json:async()=>({id:'member'})};
  if(url.includes('organization_members'))return {ok:true,status:200,json:async()=>([{organization_role:'member'}])};
  if(url.includes('/organizations?'))return {ok:true,status:200,json:async()=>([{owner_id:'owner'}])};
  if(url.includes('rpc/dochub_can_folder_action'))return {ok:true,status:200,json:async()=>true};
  if(url.includes('organization_uploads?id=eq.')&&opts.method==='DELETE')return {ok:true,status:200,json:async()=>[]};
  if(url.includes('organization_uploads?id=eq.'))return {ok:true,status:200,json:async()=>[session]};
  if(url==='https://www.googleapis.com/upload/session-locked')return {ok:false,status:308,headers:new Map([['range','bytes=0-511']])};
  if(url.includes('googleapis.com/drive/v3/files/')){metadataLookup++;return {ok:true,status:200,json:async()=>({id:'attacker-file',size:1024})};}
  if(url.includes('documents_index?on_conflict=')){indexed++;return {ok:true,status:200,json:async()=>[{id:1}]};}
  throw Error('Unexpected url: '+url);
 });
 const res=response();
 await api(request('/api/organization?action=upload-finish&organization='+org,{authorization:'Bearer jwt','content-type':'application/json'},'POST',JSON.stringify({upload:uploadId,driveFileId:'attacker-file'})),res);
 assert.equal(res.statusCode,409);
 assert.equal(indexed,0);
 assert.equal(metadataLookup,0,'A browser-supplied Drive ID must never be looked up or indexed');
});

test('upload-chunk uploads byte range without requiring Google token refresh and completes file',async()=>{
 const uploadId='33333333-3333-3333-3333-333333333333';
 let tokenRefreshed=false;let uploadedChunk=null;
 const api=createApi({SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'service'},async(url,opts={})=>{
  if(url.includes('/auth/v1/user'))return {ok:true,status:200,json:async()=>({id:'member'})};
  if(url.includes('organization_members'))return {ok:true,status:200,json:async()=>([{organization_role:'member'}])};
  if(url.includes('/organizations?'))return {ok:true,status:200,json:async()=>([{owner_id:'owner'}])};
  if(url.includes('rpc/dochub_can_folder_action'))return {ok:true,status:200,json:async()=>true};
  if(url.includes('organization_uploads?id=eq.')&&opts.method==='DELETE')return {ok:true,status:200,json:async()=>[]};
  if(url.includes('organization_uploads?id=eq.'))return {ok:true,status:200,json:async()=>([{id:uploadId,organization_id:org,user_id:'member',doc_uid:'doc-chunk',folder_uid:'all',name:'chunk.pdf',ext:'pdf',bytes:262144,mime:'application/pdf',expires_at:new Date(Date.now()+60000).toISOString(),encrypted_url:seal('https://www.googleapis.com/upload/session-chunk','service',uploadId)}])};
  if(url.includes('oauth2.googleapis.com/token')){tokenRefreshed=true;return {ok:true,status:200,json:async()=>({})};}
  if(url==='https://www.googleapis.com/upload/session-chunk'){
    uploadedChunk=opts.headers['Content-Range'];
    return {ok:true,status:200,json:async()=>({id:'drive-file-chunk',size:262144})};
  }
  if(url.includes('documents_index?on_conflict='))return {ok:true,status:200,json:async()=>[{id:1}]};
  throw Error('Unexpected url: '+url);
 });
 const chunkData=Buffer.alloc(262144);
 const res=response();
 await api(request('/api/organization?action=upload-chunk&organization='+org+'&upload='+uploadId,{authorization:'Bearer jwt','content-range':'bytes 0-262143/262144'},'PUT',chunkData),res);
 assert.equal(res.data.complete,true);
 assert.equal(uploadedChunk,'bytes 0-262143/262144');
 assert.equal(tokenRefreshed,false,'Must not call Google OAuth token refresh on chunk upload');
});
