import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { executeCodeTask } from './code-01/execute.mjs';
import { reviewCodeTask,runCodeCycle } from './code-01/review.mjs';

function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'code-review-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const repo=path.join(dir,'repo');fs.mkdirSync(repo);fs.writeFileSync(path.join(repo,'app.js'),'old');
  const p=new AionPlatform({dataDir:path.join(dir,'state')});
  const task=p.createTask('ATLAS',{assigned_to:'CODE-01',project:'AION-HQ',objective:'Fix app',acceptance_criteria:['Works']});
  const grant={task_id:task.task_id,project:'AION-HQ',repo_root:repo,workspace_root:path.join(dir,'work'),files:['app.js'],editable:['app.js'],image:'node:24-alpine',commands:[{id:'test',argv:['node','app.js']}],acceptance_checks:{Works:['test']}};
  let step=0;
  const actions=[{tool:'read_file',path:'app.js'},{tool:'write_file',path:'app.js',content:'fixed'},{tool:'run_check',command_id:'test'},{tool:'diff'},{tool:'finish'}];
  const fetchImpl=async()=>({ok:true,json:async()=>({message:{content:JSON.stringify(actions[step++%actions.length])}})});
  return {p,task,grant,fetchImpl};
}
const pass=async()=>({exit_code:0,output:'PASS',timed_out:false});

test('independent QA reruns checks on its own copy before CEO acceptance',async t=>{
  const {p,task,grant,fetchImpl}=setup(t);
  await executeCodeTask(p,task.task_id,grant,{fetchImpl,processRunner:pass});
  assert.throws(()=>p.ceoReview('ATLAS',task.task_id),e=>e.code==='QA_EVIDENCE_REQUIRED');
  const report=await reviewCodeTask(p,task.task_id,grant,{processRunner:pass});
  assert.equal(report.result,'PASS');
  assert.notEqual(report.workspace,p.task(task.task_id).outputs.code_execution.workspace);
  assert.equal(p.task(task.task_id).status,'READY_FOR_CEO_REVIEW');
  assert.equal(p.ceoReview('ATLAS',task.task_id).status,'COMPLETED');
});

test('QA fail sends feedback, creates a new execution, retests and preserves attempt history',async t=>{
  const {p,task,grant,fetchImpl}=setup(t);
  let runs=0;
  const processRunner=async(_file,args)=>{
    if(args[0]==='rm') return pass();
    runs++;return {exit_code:runs===2?1:0,output:runs===2?'Acceptance failed':'PASS',timed_out:false};
  };
  const result=await runCodeCycle(p,task.task_id,grant,{fetchImpl,processRunner});
  assert.equal(result.status,'READY_FOR_CEO_REVIEW');
  assert.equal(result.outputs.code_attempts.length,2);
  assert.notEqual(result.outputs.code_attempts[0].execution_id,result.outputs.code_execution.execution_id);
  assert.equal(p.inbox('CODE-01').filter(m=>m.type==='CODE_REWORK_REQUIRED').length,1);
  assert.equal(p.state().tasks.filter(x=>x.parent_task_id===task.task_id&&x.status==='QA_FAIL').length,1);
  assert.equal(p.ceoReview('ATLAS',task.task_id).status,'COMPLETED');
});

test('QA loop stops at three executions and cannot be restarted automatically',async t=>{
  const {p,task,grant,fetchImpl}=setup(t);
  let runs=0;
  const processRunner=async(_file,args)=>{if(args[0]==='rm') return pass();runs++;return {exit_code:runs%2===0?1:0,output:'result',timed_out:false};};
  const result=await runCodeCycle(p,task.task_id,grant,{fetchImpl,processRunner});
  assert.equal(result.status,'REWORK_LIMIT_REACHED');assert.equal(result.outputs.code_attempts.length,3);
  assert.throws(()=>p.ceoReview('ATLAS',task.task_id),/QA/);
  await assert.rejects(executeCodeTask(p,task.task_id,grant,{fetchImpl}),/eligible|limit/);
});

test('QA cannot be self-approved or bypassed with a generic QA payload',async t=>{
  const {p,task,grant,fetchImpl}=setup(t);
  await executeCodeTask(p,task.task_id,grant,{fetchImpl,processRunner:pass});
  await assert.rejects(reviewCodeTask(p,task.task_id,grant,{actor:'CODE-01',processRunner:pass}),/Independent/);
  const report=await reviewCodeTask(p,task.task_id,grant,{processRunner:pass});
  assert.throws(()=>p.qaResult('QA-01',report.qa_task_id,'PASS'),e=>e.code==='DEDICATED_QA_REQUIRED');
});

test('CEO rejects changed content and stale execution IDs after QA',async t=>{
  const {p,task,grant,fetchImpl}=setup(t);
  await runCodeCycle(p,task.task_id,grant,{fetchImpl,processRunner:pass});
  const exec=p.task(task.task_id).outputs.code_execution;
  fs.writeFileSync(path.join(exec.workspace,'app.js'),'tampered');
  assert.throws(()=>p.ceoReview('ATLAS',task.task_id),e=>e.code==='STALE_QA_EVIDENCE');
  fs.writeFileSync(path.join(exec.workspace,'app.js'),'fixed');
  p.store.mutate(s=>{s.tasks.find(x=>x.task_id===task.task_id).outputs.code_qa.execution_id='old';});
  assert.throws(()=>p.ceoReview('ATLAS',task.task_id),e=>e.code==='QA_EVIDENCE_REQUIRED');
});

test('QA requires operator mapping of every acceptance criterion',async t=>{
  const {p,task,grant,fetchImpl}=setup(t);delete grant.acceptance_checks;
  await executeCodeTask(p,task.task_id,grant,{fetchImpl,processRunner:pass});
  const report=await reviewCodeTask(p,task.task_id,grant,{processRunner:()=>assert.fail('no approved acceptance checks')});
  assert.equal(report.result,'FAIL');assert.match(report.findings[0],/mapping/);
});

test('production requirement remains behind owner approval even when CEO omits the flag',async t=>{
  const {p,task,grant,fetchImpl}=setup(t);
  p.store.mutate(s=>{s.tasks.find(x=>x.task_id===task.task_id).inputs.requires_production=true;});
  await runCodeCycle(p,task.task_id,grant,{fetchImpl,processRunner:pass});
  assert.equal(p.ceoReview('ATLAS',task.task_id).status,'WAITING_OWNER_APPROVAL');
  assert.equal(p.ownerApprove('OWNER',task.task_id).approval_state,'APPROVED');
  assert.equal(p.task(task.task_id).status,'WAITING_OWNER_APPROVAL');
});
