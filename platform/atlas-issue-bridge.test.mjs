import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAtlasIssue, resultMarkdown } from './atlas-issue-bridge.mjs';

test('bridge accepts only Gamevalentine sandbox TrainingBot tasks',()=>{
  const out=parseAtlasIssue({
    author:'Gamevalentine',
    issueNumber:42,
    body:JSON.stringify({
      project:'TrainingBot',
      objective:'Kiểm tra build sandbox và yêu cầu QA xác minh độc lập.',
      scope:'aion-sandbox only',
      acceptance_criteria:['Build pass','QA evidence pass'],
      risk_level:'low',
      execution_mode:'sandbox-only'
    })
  });
  assert.equal(out.task_id,'ATLAS-ISSUE-42');
  assert.equal(out.actor_id,'ATLAS');
  assert.equal(out.assigned_to,'TB-01');
});

test('bridge rejects other authors and production mode',()=>{
  const base=JSON.stringify({objective:'safe task',acceptance_criteria:['pass'],execution_mode:'sandbox-only'});
  assert.throws(()=>parseAtlasIssue({author:'someone',issueNumber:1,body:base}),/untrusted/);
  assert.throws(()=>parseAtlasIssue({author:'Gamevalentine',issueNumber:1,body:JSON.stringify({objective:'production task',acceptance_criteria:['pass'],execution_mode:'production'})}),/sandbox-only/);
});

test('result comment contains machine-readable CEO return envelope',()=>{
  const md=resultMarkdown({
    task_id:'ATLAS-ISSUE-42',
    status:'READY_FOR_CEO_REVIEW',
    manager_summary:{status:'PASS'},
    children:[
      {task_id:'D',assigned_to:'DEV-TB-01',status:'EXECUTION_PASSED'},
      {task_id:'Q',assigned_to:'QA-TB-01',status:'QA_PASS'}
    ]
  },{issueNumber:42});
  assert.match(md,/READY_FOR_CEO_REVIEW/);
  assert.match(md,/AION_RESULT/);
  assert.match(md,/ATLAS-ISSUE-42/);
});
