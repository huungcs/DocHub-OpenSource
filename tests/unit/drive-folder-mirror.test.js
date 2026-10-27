const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('Drive mirror identifies folders by stable app properties, not name',async()=>{
 const calls=[],ctx={window:{},URLSearchParams,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>calls.length===1?{files:[]}:{id:'child'}};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../src/integrations/google-drive/client.js'),'utf8'),ctx);
 await ctx.window.DocHubDrive.getOrCreateMirroredFolder('token','org','training','Đào tạo','root');
 const body=JSON.parse(calls[1].options.body);
 assert.equal(body.appProperties.dochub_folder,'training');assert.equal(body.appProperties.dochub_org,'org');assert.deepEqual(body.parents,['root']);
});
