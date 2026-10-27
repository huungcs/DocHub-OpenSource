const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../src/app/index.template.html'),'utf8');
const code='function createUploadScheduler'+source.split('function createUploadScheduler')[1].split('  const scheduleUpload=')[0];
const create=vm.runInNewContext(code+';createUploadScheduler');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Uploads share three slots and begin the next file without waiting for a batch',async()=>{
 let active=0,peak=0;const started=[],release=[];
 const schedule=create(3,job=>new Promise(resolve=>{active++;peak=Math.max(peak,active);started.push(job.id);release[job.id]=()=>{active--;resolve(true);};}));
 const tasks=Array.from({length:5},(_,id)=>schedule({id}));
 await tick();assert.deepEqual(started,[0,1,2]);
 release[1]();await tick();assert.deepEqual(started,[0,1,2,3]);
 release[0]();await tick();assert.deepEqual(started,[0,1,2,3,4]);
 release[2]();release[3]();release[4]();await Promise.all(tasks);assert.equal(peak,3);
});
test('Cancelled queued files never upload and failed jobs free a slot',async()=>{
 const seen=[];const schedule=create(1,async job=>{seen.push(job.id);if(job.id===1)throw Error('offline');return true;});
 const results=await Promise.allSettled([schedule({id:1}),schedule({id:2,status:'cancelled'}),schedule({id:3})]);
 assert.deepEqual(seen,[1,3]);assert.equal(results[0].status,'rejected');assert.equal(results[1].value,false);assert.equal(results[2].value,true);
});
