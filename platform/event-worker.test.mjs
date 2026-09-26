import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, applyEvent } from './event-worker.mjs';

test('durable state enforces reporting chain',()=>{
  const s=createEmptyState();
  assert.throws(()=>applyEvent(s,'create_task',{actor_id:'ATLAS',assigned_to:'DEV-TB-01',task_id:'X'}),/cannot assign directly/);
  const a=applyEvent(s,'create_task',{actor_id:'ATLAS',assigned_to:'TB-01',task_id:'ROOT',objective:'pilot'});
  assert.equal(a.tasks[0].assigned_to,'TB-01');
});

test('executor result persists task evidence and DEV inbox',()=>{
  const s=createEmptyState();
  const n=applyEvent(s,'executor_result',{task_id:'AION-PILOT-001',result:'PASS',run_id:'123',run_url:'https://example/123',operation:'validate-sandbox',conclusion:'success'});
  assert.equal(n.tasks[0].status,'EXECUTION_PASSED');
  assert.equal(n.executions[0].status,'SUCCESS');
  assert.ok(n.messages.some(x=>x.to==='DEV-TB-01'&&x.type==='EXECUTION_RESULT'));
  assert.ok(n.audit.some(x=>x.action==='EXECUTION_RESULT'));
});

test('memory survives unrelated events',()=>{
  let s=createEmptyState();
  s=applyEvent(s,'memory_write',{owner:'TB-01',key:'shared:note',value:'remember',visibility:'shared'});
  s=applyEvent(s,'message_send',{from:'TB-01',to:'ATLAS',message_type:'STATUS',payload:{ok:true}});
  assert.equal(s.memories.find(x=>x.key==='shared:note').value,'remember');
});


test('duplicate task IDs are idempotent',()=>{
  let s=createEmptyState();
  const payload={actor_id:'ATLAS',assigned_to:'TB-01',task_id:'ATLAS-ISSUE-99',project:'TrainingBot',objective:'same task'};
  s=applyEvent(s,'create_task',payload);
  s=applyEvent(s,'create_task',payload);
  assert.equal(s.tasks.filter(t=>t.task_id==='ATLAS-ISSUE-99').length,1);
  assert.ok(s.audit.some(x=>x.action==='TASK_DUPLICATE_IGNORED'&&x.task_id==='ATLAS-ISSUE-99'));
});
