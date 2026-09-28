import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyState, applyEvent } from './event-worker.mjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const agents=JSON.parse(fs.readFileSync(path.join(__dirname,'agents.json'),'utf8'));
const office=JSON.parse(fs.readFileSync(path.join(__dirname,'trainingbot-office.json'),'utf8'));

const specialistIds=['DEV-TB-01','QA-TB-01','SEO-TB-01','CONTENT-TB-01','SECURITY-TB-01','OPS-TB-01','ANALYTICS-TB-01','PUBLISHER-TB-01','COMMS-TB-01'];

test('TrainingBot office has one manager and nine direct specialists',()=>{
  assert.equal(office.manager,'TB-01');
  const direct=agents.filter(a=>a.reports_to==='TB-01').map(a=>a.agent_id).sort();
  assert.deepEqual(direct,specialistIds.slice().sort());
});

test('TB-01 can assign every TrainingBot office specialist while ATLAS cannot bypass manager',()=>{
  const manager=agents.find(a=>a.agent_id==='TB-01');
  const atlas=agents.find(a=>a.agent_id==='ATLAS');
  assert.deepEqual(manager.can_assign_to.slice().sort(),specialistIds.slice().sort());
  assert.ok(atlas.can_assign_to.includes('TB-01'));
  assert.ok(atlas.can_assign_to.includes('CODE-01'));
  assert.ok(atlas.can_assign_to.includes('QA-01'));
  assert.equal(agents.find(a=>a.agent_id==='CODE-01').reports_to,'ATLAS');
  for(const id of specialistIds){
    assert.equal(atlas.can_assign_to.includes(id),false,'ATLAS bypassed TB-01 for '+id);
  }
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


test('publisher role can prepare content but cannot publish unapproved content or spend money',()=>{
  const a=agents.find(x=>x.agent_id==='PUBLISHER-TB-01');
  assert.ok(a.permissions.includes('adapt_content_per_platform'));
  assert.ok(a.permissions.includes('prepare_publish_queue'));
  assert.ok(a.prohibited_actions.includes('publish_unapproved_content'));
  assert.ok(a.prohibited_actions.includes('create_paid_campaign'));
  assert.ok(a.prohibited_actions.includes('spend_money'));
  assert.equal(office.governance.publisher_requires_approved_content,true);
  assert.equal(office.governance.no_paid_campaign_without_owner,true);
});


test('communications role only auto-replies low-risk messages and escalates sensitive cases',()=>{
  const a=agents.find(x=>x.agent_id==='COMMS-TB-01');
  assert.ok(a.permissions.includes('read_support_mail'));
  assert.ok(a.permissions.includes('send_approved_mail_reply'));
  assert.ok(a.permissions.includes('read_group_messages'));
  assert.ok(a.permissions.includes('send_approved_group_reply'));
  assert.ok(a.permissions.includes('escalate_to_manager'));
  assert.ok(a.prohibited_actions.includes('bulk_marketing_email'));
  assert.ok(a.prohibited_actions.includes('make_financial_commitment'));
  assert.ok(a.prohibited_actions.includes('share_sensitive_data'));
  assert.equal(office.governance.comms_low_risk_auto_reply_only,true);
  assert.equal(office.governance.comms_escalates_sensitive_cases,true);
});
