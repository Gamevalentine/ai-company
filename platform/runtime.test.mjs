import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform, PlatformError } from './runtime.mjs';

function fresh(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aion-platform-'));
  return {dir,p:new AionPlatform({dataDir:dir})};
}
function expectCode(fn,code){
  assert.throws(fn,e=>e instanceof PlatformError&&e.code===code);
}

test('AC-01 agents have separate stable identities',()=>{
  const {p}=fresh();
  const ids=p.state().agents.map(a=>a.agent_id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(ids.includes('TB-01')&&ids.includes('DEV-TB-01')&&ids.includes('QA-TB-01'));
});

test('AC-02 reporting chain blocks ATLAS direct assignment to DEV',()=>{
  const {p}=fresh();
  expectCode(()=>p.createTask('ATLAS',{assigned_to:'DEV-TB-01',project:'TrainingBot',objective:'bad direct route'}),'REPORTING_CHAIN_DENIED');
  const t=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'pilot'});
  const sub=p.createSubtask('TB-01',t.task_id,{assigned_to:'DEV-TB-01',objective:'sandbox build'});
  assert.equal(sub.parent_task_id,t.task_id);
});

test('AC-03 role permissions block DEV QA result and QA source permission',()=>{
  const {p}=fresh();
  const root=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'pilot'});
  const dev=p.createSubtask('TB-01',root.task_id,{assigned_to:'DEV-TB-01',objective:'build'});
  expectCode(()=>p.qaResult('DEV-TB-01',dev.task_id,'PASS',{}),'QA_ONLY');
  assert.ok(p.agent('QA-TB-01').prohibited_actions.includes('edit_source'));
});

test('AC-04 task store survives runtime restart',()=>{
  const {p,dir}=fresh();
  const t=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'persist'});
  const p2=new AionPlatform({dataDir:dir});
  assert.equal(p2.task(t.task_id).objective,'persist');
});

test('AC-05 private memory is isolated; shared subordinate memory is visible to manager',()=>{
  const {p}=fresh();
  p.writeMemory('QA-TB-01',{key:'private-note',value:'secret',visibility:'private'});
  expectCode(()=>p.readMemory('DEV-TB-01','QA-TB-01','private-note'),'MEMORY_DENIED');
  expectCode(()=>p.readMemory('TB-01','QA-TB-01','private-note'),'MEMORY_DENIED');
  p.writeMemory('QA-TB-01',{key:'shared:qa-status',value:'ready',visibility:'shared'});
  assert.equal(p.readMemory('TB-01','QA-TB-01','shared:qa-status').value,'ready');
});

test('AC-06 inbox/outbox route is traceable',()=>{
  const {p}=fresh();
  const t=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'message'});
  p.sendMessage('ATLAS','TB-01',t.task_id,'GOAL',{priority:'high'});
  assert.equal(p.inbox('TB-01').at(-1).type,'GOAL');
  assert.equal(p.outbox('ATLAS').at(-1).to,'TB-01');
});

test('AC-07 failed dispatch is retained and retryable',()=>{
  const {p}=fresh();
  p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'queue'});
  const failed=p.dispatchNext('TB-01',{simulateFailure:true});
  assert.equal(failed.status,'FAILED');
  const retried=p.dispatchNext('TB-01');
  assert.equal(retried.status,'DELIVERED');
  assert.equal(retried.attempts,2);
});

test('AC-08 safe executor accepts sandbox and hard-blocks main',()=>{
  const {p}=fresh();
  const root=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'pilot'});
  const dev=p.createSubtask('TB-01',root.task_id,{assigned_to:'DEV-TB-01',objective:'build'});
  const ex=p.requestExecution('DEV-TB-01',dev.task_id,{operation:'sandbox_build',target_branch:'aion-sandbox'});
  assert.equal(ex.status,'PENDING_EXTERNAL');
  expectCode(()=>p.requestExecution('DEV-TB-01',dev.task_id,{operation:'production_deploy',target_branch:'main'}),'PRODUCTION_HARD_BLOCK');
});

test('AC-09 and AC-10 QA PASS/FAIL stays independent and rework is preserved in audit',()=>{
  const {p}=fresh();
  const root=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'pilot'});
  const qa1=p.createSubtask('TB-01',root.task_id,{assigned_to:'QA-TB-01',objective:'qa round 1'});
  p.qaResult('QA-TB-01',qa1.task_id,'FAIL',{reason:'fixture'});
  assert.equal(p.managerReview('TB-01',root.task_id).status,'NEEDS_REWORK');
  const dev=p.createSubtask('TB-01',root.task_id,{assigned_to:'DEV-TB-01',objective:'rework'});
  p.submitEvidence('DEV-TB-01',dev.task_id,{type:'PATCH',ref:'sandbox-commit-2'});
  const qa2=p.createSubtask('TB-01',root.task_id,{assigned_to:'QA-TB-01',objective:'qa round 2'});
  p.qaResult('QA-TB-01',qa2.task_id,'PASS',{artifact:'sandbox-commit-2'});
  assert.equal(p.managerReview('TB-01',root.task_id).status,'MANAGER_REVIEW');
  const timeline=p.timeline(root.task_id);
  assert.ok(timeline.some(x=>x.action==='QA_FAIL'));
  assert.ok(timeline.some(x=>x.action==='QA_PASS'));
});

test('AC-11/12 production requires owner approval state; QA PASS does not deploy',()=>{
  const {p}=fresh();
  const root=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'release candidate'});
  const qa=p.createSubtask('TB-01',root.task_id,{assigned_to:'QA-TB-01',objective:'qa'});
  p.qaResult('QA-TB-01',qa.task_id,'PASS',{artifact:'abc'});
  p.managerReview('TB-01',root.task_id);
  const reviewed=p.ceoReview('ATLAS',root.task_id,{requiresProduction:true});
  assert.equal(reviewed.status,'WAITING_OWNER_APPROVAL');
  assert.equal(reviewed.approval_state,'PENDING_OWNER');
  assert.equal(p.ownerApprove('OWNER',root.task_id).approval_state,'APPROVED');
});

test('AC-13 full task timeline remains queryable',()=>{
  const {p}=fresh();
  const root=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'trace'});
  const dev=p.createSubtask('TB-01',root.task_id,{assigned_to:'DEV-TB-01',objective:'build'});
  p.submitEvidence('DEV-TB-01',dev.task_id,{artifact:'x'});
  const events=p.timeline(root.task_id);
  assert.ok(events.length>=3);
});

test('QA-01 is an independent CEO-managed QA employee',()=>{
  const {p}=fresh();
  const qa=p.agent('QA-01');
  assert.equal(qa.reports_to,'ATLAS');
  assert.equal(qa.role,'qa');
  assert.ok(qa.prohibited_actions.includes('edit_source'));
  assert.ok(p.agent('ATLAS').can_assign_to.includes('QA-01'));

  const task=p.createTask('ATLAS',{
    assigned_to:'QA-01',
    project:'AION-HQ',
    objective:'Verify an AION HQ change independently',
    acceptance_criteria:['changed behavior is verified with evidence']
  });
  assert.equal(task.created_by,'ATLAS');
  assert.equal(task.assigned_to,'QA-01');

  const result=p.qaResult('QA-01',task.task_id,'PASS',{type:'QA_REPORT',evidence:'fixture'});
  assert.equal(result.status,'QA_PASS');
  assert.equal(result.evidence.at(-1).agent_id,'QA-01');
});

