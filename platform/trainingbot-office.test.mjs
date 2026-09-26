import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyState, applyEvent } from './event-worker.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const agents=JSON.parse(fs.readFileSync(path.join(__dirname,'agents.json'),'utf8'));
const office=JSON.parse(fs.readFileSync(path.join(__dirname,'trainingbot-office.json'),'utf8'));

const specialistIds=['DEV-TB-01','QA-TB-01','SEO-TB-01','CONTENT-TB-01','SECURITY-TB-01','OPS-TB-01','ANALYTICS-TB-01'];

test('TrainingBot office has one manager and seven direct specialists',()=>{
  assert.equal(office.manager,'TB-01');
  const direct=agents.filter(a=>a.reports_to==='TB-01').map(a=>a.agent_id).sort();
  assert.deepEqual(direct,specialistIds.slice().sort());
});

test('TB-01 can assign every TrainingBot office specialist while ATLAS cannot bypass manager',()=>{
  const manager=agents.find(a=>a.agent_id==='TB-01');
  const atlas=agents.find(a=>a.agent_id==='ATLAS');
  assert.deepEqual(manager.can_assign_to.slice().sort(),specialistIds.slice().sort());
  assert.deepEqual(atlas.can_assign_to,['TB-01']);
});

test('all specialists are production-blocked and cannot delegate laterally',()=>{
  for(const id of specialistIds){
    const a=agents.find(x=>x.agent_id===id);
    assert.ok(a,'missing '+id);
    assert.deepEqual(a.can_assign_to,[]);
    assert.ok(a.prohibited_actions.includes('production_deploy'),'production not blocked for '+id);
  }
});

test('durable state lets TB-01 create specialist tasks but blocks ATLAS bypass',()=>{
  let s=createEmptyState();
  s=applyEvent(s,'create_task',{actor_id:'ATLAS',assigned_to:'TB-01',task_id:'OFFICE-ROOT',project:'TrainingBot',objective:'office task'});
  s=applyEvent(s,'create_task',{actor_id:'TB-01',assigned_to:'SEO-TB-01',task_id:'OFFICE-SEO',parent_task_id:'OFFICE-ROOT',project:'TrainingBot',objective:'seo audit'});
  assert.equal(s.tasks.find(t=>t.task_id==='OFFICE-SEO').assigned_to,'SEO-TB-01');
  assert.throws(()=>applyEvent(s,'create_task',{actor_id:'ATLAS',assigned_to:'SEO-TB-01',task_id:'BAD',project:'TrainingBot',objective:'bypass'}),/cannot assign directly/);
});

test('analytics role explicitly blocks sensitive demographic inference',()=>{
  const a=agents.find(x=>x.agent_id==='ANALYTICS-TB-01');
  assert.ok(a.prohibited_actions.includes('infer_sensitive_demographics'));
  assert.equal(office.governance.no_sensitive_demographic_inference,true);
});
