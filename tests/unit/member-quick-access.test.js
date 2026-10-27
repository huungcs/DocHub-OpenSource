const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../src/app/index.template.html'),'utf8');
const block=source.split("} else if(kind==='user') {")[1].split("} else if(kind==='group') {")[0];
test('Permission inspector directs member setup to the members page',()=>{
 const page='function permissionsPage'+source.split('function permissionsPage')[1].split('  function renderPermissionPickerList')[0];
 const html=vm.runInNewContext(page+';permissionsPage()',{
  ui:{permissionFolder:'all',inspectUser:'u1'},folder:id=>id==='all'?{id:'all',name:'All'}:null,active:Boolean,
  inheritedRules:()=>[],resolveInspectUser:()=> 'u1',effectivePermissions:()=>({permissions:[],sources:[]}),
  state:{users:[],preferences:{}},sectionHeader:(a,b,c)=>a+b+c,e:String,icon:()=>'',window:{},
  ACTIONS:{},ROLES:{},user:()=>null,inspectUserMessage:()=>''
 });
 assert.doesNotMatch(html,/data-action="new-user"/);
 assert.match(html,/data-section="users"/);
 assert.match(html,/Kiểm tra quyền truy cập/);
 assert.ok(html.indexOf("Quyền của thành viên") < html.indexOf("Điều chỉnh quyền thư mục (nâng cao)"));
});
async function submit({role='viewer',scope='team',id='',denied=false}={}){
 const state={users:id?[{id,email:'old@test.com'}]:[],groups:[],acl:[]};
 const values={name:'Employee',email:'employee@test.com',quickRole:role,quickScope:scope};
 const checks=[];
 const context={state,id,data:{get:k=>values[k],getAll:()=>[],has:()=>true},cleanName:v=>v,
  requirePermission:async(folder,action)=>{checks.push([folder,action]);if(denied)throw Error('Denied');},
  active:v=>!!v,folder:id=>id==='team'?{id}:null,user:id=>state.users.find(u=>u.id===id),
  uid:type=>type+'-new',commit:()=>{},toast:()=>{}};
 await vm.runInNewContext('(async()=>{'+block+'})()',context);
 return {state,checks};
}
test('Adding a member saves the selected scoped role with the member',async()=>{
 const {state,checks}=await submit();
 assert.equal(state.users.length,1);assert.equal(state.acl.length,1);
 assert.equal(state.acl[0].principalId,state.users[0].id);
 assert.equal(state.acl[0].resourceId,'team');assert.equal(state.acl[0].role,'viewer');
 assert.deepEqual(checks,[['all','manage'],['team','manage']]);
});
test('Quick roles cannot grant ownership or target missing folders',async()=>{
 await assert.rejects(submit({role:'owner'}),/Vai trò/);
 await assert.rejects(submit({scope:'missing'}),/thư mục/);
 await assert.rejects(submit({denied:true}),/Denied/);
 await assert.rejects(submit({role:'keep'}),/Chọn vai trò/);
});
test('Editing with keep selected does not create a new grant',async()=>{
 const {state}=await submit({id:'existing',role:'keep'});
 assert.equal(state.users.length,1);assert.equal(state.acl.length,0);
});
