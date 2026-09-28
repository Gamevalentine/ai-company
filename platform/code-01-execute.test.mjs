import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { createWorkspace,relativeFile,runProcess } from './code-01/tools.mjs';
import { executeCodeTask } from './code-01/execute.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'code01-execute-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repo=path.join(root,'source');fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo,'sum.cjs'),'module.exports=(a,b)=>a-b;\n');
  fs.writeFileSync(path.join(repo,'check.cjs'),"require('node:assert/strict').equal(require('./sum.cjs')(2,3),5);\n");
  const p=new AionPlatform({dataDir:path.join(root,'state')});
  const task=p.createTask('ATLAS',{assigned_to:'CODE-01',project:'AION-HQ',objective:'Fix addition',acceptance_criteria:['2+3 equals 5']});
  const grant={task_id:task.task_id,project:'AION-HQ',repo_root:repo,workspace_root:path.join(root,'work'),files:['sum.cjs','check.cjs'],editable:['sum.cjs'],image:'node:24-alpine',commands:[{id:'test',argv:['node','check.cjs']}]};
  return {root,repo,p,task,grant};
}
function model(actions){let index=0;return async()=>({ok:true,json:async()=>({message:{content:JSON.stringify(actions[index++])}})});}
const success=async()=>({exit_code:0,output:'ok',timed_out:false,truncated:false});
const sequence=()=>[
  {tool:'read_file',path:'sum.cjs'},
  {tool:'write_file',path:'sum.cjs',content:'module.exports=(a,b)=>a+b;\n'},
  {tool:'run_check',command_id:'test'},
  {tool:'diff'},
  {tool:'finish'}
];

test('CODE-01 edits a copy and runs a real fixture check; model and container adapter are simulated',async t=>{
  const {p,task,grant,repo}=fixture(t);
  let runs=0;
  // Test-only adapter runs this known fixture with Node. Production has no host fallback.
  const runner=async(_file,args)=>{
    if(args[0]==='rm') return success();
    runs++;
    assert.ok(args.includes('--network=none'));
    assert.ok(args.includes('--read-only'));
    assert.ok(args.includes('--pull=never'));
    assert.ok(args.includes('--cap-drop=ALL'));
    const mount=args[args.indexOf('--mount')+1];
    assert.match(mount,/,readonly$/);
    const dir=mount.match(/^type=bind,source=(.*),target=/)[1];
    return runProcess(process.execPath,[path.join(dir,'check.cjs')]);
  };
  const actions=sequence();
  actions.splice(1,0,{tool:'run_check',command_id:'test'});
  const result=await executeCodeTask(p,task.task_id,grant,{fetchImpl:model(actions),processRunner:runner});
  assert.equal(runs,2);
  assert.equal(result.status,'WAITING_QA');
  assert.equal(result.checks[0].exit_code,1);
  assert.equal(result.checks[1].exit_code,0);
  assert.equal(result.changes.length,1);
  assert.match(fs.readFileSync(path.join(repo,'sum.cjs'),'utf8'),/a-b/);
  assert.match(fs.readFileSync(path.join(result.workspace,'sum.cjs'),'utf8'),/a\+b/);
  assert.equal(p.task(task.task_id).status,'WAITING_QA');
  assert.equal(p.inbox('ATLAS').at(-1).payload.qa_approved,false);
});

test('CODE-01 blocks ungranted files, immutable checks, secrets and traversal',t=>{
  const {grant,task}=fixture(t),w=createWorkspace(grant,task);
  assert.throws(()=>w.read('../source/sum.cjs'),/grant/);
  assert.throws(()=>w.write('check.cjs',''),/grant/);
  for(const name of ['../escape','.env','.git/config','C:/secret','foo\\bar','foo/../bar','private.pem','NUL','sum.cjs.']) assert.throws(()=>relativeFile(name));
  assert.throws(()=>createWorkspace({...grant,task_id:'other'},task),/match/);
  assert.throws(()=>createWorkspace({...grant,workspace_root:path.join(grant.repo_root,'work')},task),/separate/);
});

test('CODE-01 refuses symlink directory inputs',t=>{
  const {grant,task,root,repo}=fixture(t);
  const outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'data.txt'),'private');
  fs.symlinkSync(outside,path.join(repo,'link'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>createWorkspace({...grant,files:['link/data.txt'],editable:[]},task),/Symlink/);
});

test('CODE-01 fails closed when Docker is unavailable and records a failed check',async t=>{
  const {p,task,grant}=fixture(t);
  const out=await executeCodeTask(p,task.task_id,grant,{fetchImpl:model(sequence()),processRunner:async()=>{throw new Error('ENOENT');}});
  assert.equal(out.status,'CODE_BLOCKED');
  assert.equal(out.checks[0].passed,false);
  assert.match(out.error,/Passing checks/);
});

test('CODE-01 cannot bypass checks or final diff review',async t=>{
  for(const actions of [[{tool:'finish'}],[{tool:'run_check',command_id:'test'},{tool:'finish'}]]){
    const {p,task,grant}=fixture(t);
    const out=await executeCodeTask(p,task.task_id,grant,{fetchImpl:model(actions),processRunner:success});
    assert.equal(out.status,'CODE_BLOCKED');
  }
});

test('CODE-01 invalidates earlier checks after edits and honors latest failure',async t=>{
  const {grant,task}=fixture(t),w=createWorkspace(grant,task);
  await w.check('test',{processRunner:success});assert.equal(w.verified(),true);
  w.write('sum.cjs','module.exports=()=>5;');assert.equal(w.verified(),false);
  await w.check('test',{processRunner:success});assert.equal(w.verified(),true);
  await w.check('test',{processRunner:async()=>({exit_code:1,timed_out:false,output:'failed'})});assert.equal(w.verified(),false);
});

test('CODE-01 requires read-before-write and rejects arbitrary commands',async t=>{
  for(const action of [{tool:'write_file',path:'sum.cjs',content:'bad'},{tool:'run_check',command_id:'rm -rf /'},{tool:'run_check',command_id:'test',command:'arbitrary'}]){
    const {p,task,grant}=fixture(t);
    const out=await executeCodeTask(p,task.task_id,grant,{fetchImpl:model([action,action]),processRunner:()=>assert.fail('must not execute')});
    assert.equal(out.status,'CODE_BLOCKED');
    assert.equal(out.changes.length,0);
  }
});

test('CODE-01 enforces tool permission and bounded loops',async t=>{
  const {p,task,grant}=fixture(t);
  p.store.mutate(s=>{s.agents.find(a=>a.agent_id==='CODE-01').allowed_tools=[];});
  await assert.rejects(executeCodeTask(p,task.task_id,grant),/not granted/);
  p.store.mutate(s=>{s.agents.find(a=>a.agent_id==='CODE-01').allowed_tools=['code01_workspace'];});
  const out=await executeCodeTask(p,task.task_id,grant,{fetchImpl:model([{tool:'diff'}]),maxSteps:1});
  assert.equal(out.status,'CODE_BLOCKED');assert.match(out.error,/step budget/);
});

test('CODE-01 container timeout triggers explicit container cleanup',async t=>{
  const {grant,task}=fixture(t),w=createWorkspace(grant,task),calls=[];
  const out=await w.check('test',{processRunner:async(_file,args)=>{calls.push(args);return {exit_code:null,timed_out:true,output:''};}});
  assert.equal(out.passed,false);
  assert.equal(calls[1][0],'rm');assert.equal(calls[1][1],'-f');
  assert.equal(calls[1][2],calls[0][calls[0].indexOf('--name')+1]);
});

test('CODE-01 Docker integration checks the actual edited copy', {skip:!process.env.CODE01_TEST_IMAGE},async t=>{
  const {p,task,grant}=fixture(t);grant.image=process.env.CODE01_TEST_IMAGE;
  const out=await executeCodeTask(p,task.task_id,grant,{fetchImpl:model(sequence())});
  assert.equal(out.status,'WAITING_QA',JSON.stringify(out));
});
