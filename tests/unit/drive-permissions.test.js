const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('Drive grants are email-only Reader/Writer and can update or revoke recorded IDs',async()=>{
 const calls=[],ctx={window:{},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({id:'grant-1'})};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/integrations/google-drive/client.js'),'utf8'),ctx);
 const api=ctx.window.DocHubDrive;
 await api.setUserPermission('token','file','employee@example.com','reader');
 assert.deepEqual(JSON.parse(calls[0].options.body),{type:'user',emailAddress:'employee@example.com',role:'reader'});
 await api.setUserPermission('token','file','employee@example.com','writer','grant-1');
 assert.equal(calls[1].options.method,'PATCH');
 await api.removePermission('token','file','grant-1');
 assert.equal(calls[2].options.method,'DELETE');
 await assert.rejects(()=>api.setUserPermission('token','file','employee@example.com','owner'));
});
