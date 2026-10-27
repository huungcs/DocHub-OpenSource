const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../src/app/index.template.html'),'utf8');
const context={};
vm.runInNewContext(source.slice(source.indexOf('  function resolveInspectUser('),source.indexOf('  function effectivePermissions(')),context);
test('Inspector resolves missing demo ID to the displayed account',()=>{
 const users=[{id:'u1',name:'CORN UNI',active:true}];
 assert.equal(context.resolveInspectUser(users,'u2'),'u1');
 assert.equal(context.resolveInspectUser(users,'u1'),'u1');
 assert.equal(context.resolveInspectUser([],'u2'),'');
});
test('Inspector preserves selected member and distinguishes absent from suspended',()=>{
 assert.equal(context.resolveInspectUser([{id:'u1'},{id:'u3'}],'u3'),'u3');
 assert.doesNotMatch(context.inspectUserMessage(undefined),/tạm dừng/);
 assert.doesNotMatch(context.inspectUserMessage({active:true}),/tạm dừng/);
 assert.doesNotMatch(context.inspectUserMessage({}),/tạm dừng/);
 assert.match(context.inspectUserMessage({active:false}),/tạm dừng/);
 assert.ok(source.indexOf('ui.inspectUser=resolveInspectUser(state.users,ui.inspectUser);')<source.indexOf('const check=effectivePermissions(ui.inspectUser,current.id);'));
});
