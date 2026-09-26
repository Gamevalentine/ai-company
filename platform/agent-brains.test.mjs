import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, applyEvent } from './event-worker.mjs';
import { ensurePilotRoot, runManagerBrain, prepareDevQueue, runQaBrain, getPilotSummary } from './agent-brains.mjs';

test('TB-01 delegates pilot to DEV and never skips manager layer',()=>{
  let s=ensurePilotRoot(createEmptyState());
  s=runManagerBrain(s);
  const root=s.tasks.find(t=>t.task_id==='AION-AGENT-PILOT-001');
  const dev=s.tasks.find(t=>t.parent_task_id===root.task_id&&t.assigned_to==='DEV-TB-01');
  assert.equal(root.status,'MANAGER_DELEGATED');
  assert.ok(dev);
  assert.equal(dev.created_by,'TB-01');
  assert.equal(s.tasks.some(t=>t.created_by==='ATLAS'&&t.assigned_to==='DEV-TB-01'),false);
});

test('DEV queue requests sandbox execution and QA independently passes evidence',()=>{
  let s=ensurePilotRoot(createEmptyState());
  s=runManagerBrain(s);
  const dq=prepareDevQueue(s);
  s=dq.state;
  assert.equal(dq.queue.length,1);
  const devId=dq.queue[0].task_id;
  s=applyEvent(s,'executor_result',{
    task_id:devId,
    result:'PASS',
    run_id:'999',
    run_url:'https://github.com/Gamevalentine/trainingbot-cloudflare/actions/runs/999',
    head_sha:'abc123',
    operation:'validate-sandbox',
    conclusion:'success'
  });
  s=runManagerBrain(s);
  const qa=s.tasks.find(t=>t.assigned_to==='QA-TB-01'&&t.parent_task_id==='AION-AGENT-PILOT-001');
  assert.ok(qa);
  s=runQaBrain(s);
  assert.equal(s.tasks.find(t=>t.task_id===qa.task_id).status,'QA_PASS');
  s=runManagerBrain(s);
  const summary=getPilotSummary(s);
  assert.equal(summary.status,'READY_FOR_CEO_REVIEW');
  assert.equal(summary.manager_summary.status,'PASS');
  assert.ok(summary.atlas_messages.some(m=>m.type==='MANAGER_REPORT'));
});

test('QA fails when execution evidence is incomplete',()=>{
  let s=ensurePilotRoot(createEmptyState());
  s=runManagerBrain(s);
  const dq=prepareDevQueue(s);
  s=dq.state;
  const dev=s.tasks.find(t=>t.task_id===dq.queue[0].task_id);
  dev.status='EXECUTION_PASSED';
  dev.outputs.execution={result:'PASS',operation:'validate-sandbox',run_url:null,head_sha:null};
  s.executions.push({task_id:dev.task_id,status:'SUCCESS',result:'PASS',branch:'aion-sandbox',operation:'validate-sandbox'});
  s=runManagerBrain(s);
  s=runQaBrain(s);
  const qa=s.tasks.find(t=>t.assigned_to==='QA-TB-01');
  assert.equal(qa.status,'QA_FAIL');
});
