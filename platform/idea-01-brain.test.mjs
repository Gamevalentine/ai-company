import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { runIdeaBrain, validateIdeaBrief } from './idea-01-brain.mjs';

function fakeFetch(reply){
  return async()=>({
    ok:true,
    json:async()=>({model:'idea-test-model',message:{content:JSON.stringify(reply)}}),
    text:async()=>''
  });
}

function validReply(overrides={}){
  return {
    status:'READY_FOR_CEO_REVIEW',
    summary:'Create a simple project task detail flow.',
    problem:'Users cannot quickly see what to do next in a task.',
    goal:'Make the next action and task state obvious.',
    target_users:['AION HQ Owner'],
    confirmed_facts:['The supplied task requests a clearer task flow.'],
    assumptions:['Keep the current visual language unless design work says otherwise.'],
    proposals:['Add a clear primary action and state summary.'],
    scope_in:['Task detail information hierarchy','Primary action'],
    scope_out:['Unrelated dashboard redesign'],
    non_goals:['Changing production deployment policy'],
    requirements:[
      {id:'REQ-01',priority:'must',description:'Show the current task state prominently.'},
      {id:'REQ-02',priority:'must',description:'Show one clear next action when an action is available.'}
    ],
    user_flow:['Open task','Read current state','Choose next action','See updated result'],
    acceptance_criteria:[
      'Current state is visible when the task opens.',
      'A valid next action is visible without opening another page.'
    ],
    dependencies:['Existing task state data'],
    risks:[{risk:'Scope creep into dashboard redesign',mitigation:'Limit changes to task detail flow.'}],
    recommended_assignees:['DESIGN-01','CODE-01','QA-01'],
    decisions_required:[],
    ...overrides
  };
}

function stateFor({assigned_to='IDEA-01',created_by='ATLAS',inputs={}}={}){
  return {
    tasks:[{
      task_id:'IDEA-TASK-001',
      project:'AION-HQ',
      created_by,
      assigned_to,
      objective:'Improve task flow',
      scope:'Requirements analysis only',
      acceptance_criteria:['Provide testable requirements'],
      status:'QUEUED',
      inputs,
      outputs:{},
      evidence:[]
    }],
    messages:[],memories:[],executions:[],audit:[]
  };
}

test('IDEA-01 is registered as a direct ATLAS report',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aion-idea-'));
  const p=new AionPlatform({dataDir:dir});
  const idea=p.agent('IDEA-01');
  assert.equal(idea.reports_to,'ATLAS');
  assert.ok(p.agent('ATLAS').can_assign_to.includes('IDEA-01'));
  assert.ok(idea.prohibited_actions.includes('make_final_product_decision'));
  assert.ok(idea.prohibited_actions.includes('production_deploy'));
});

test('IDEA-01 produces structured brief, evidence and CEO handoff',async()=>{
  const out=await runIdeaBrain(stateFor({inputs:{project_context:{known_behavior:'Current task page already exists.'}}}),{
    taskId:'IDEA-TASK-001',
    fetchImpl:fakeFetch(validReply())
  });
  const task=out.state.tasks[0];
  assert.equal(task.status,'READY_FOR_CEO_REVIEW');
  assert.equal(task.outputs.idea_brief.agent_id,'IDEA-01');
  assert.equal(task.outputs.idea_brief.model,'idea-test-model');
  assert.equal(task.outputs.idea_brief.claims_execution_performed,false);
  assert.ok(task.evidence.some(e=>e.type==='PRODUCT_BRIEF'));
  assert.ok(out.state.messages.some(m=>m.from==='IDEA-01'&&m.to==='ATLAS'&&m.type==='IDEA_BRIEF_READY'));
});

test('material decision list forces NEEDS_DECISION even if model says ready',async()=>{
  const out=await runIdeaBrain(stateFor(),{
    taskId:'IDEA-TASK-001',
    fetchImpl:fakeFetch(validReply({
      status:'READY_FOR_CEO_REVIEW',
      decisions_required:['Owner must choose whether this feature stores additional personal data.']
    }))
  });
  assert.equal(out.state.tasks[0].status,'NEEDS_DECISION');
  assert.ok(out.state.messages.some(m=>m.type==='IDEA_DECISION_REQUIRED'));
});

test('IDEA-01 filters invalid downstream assignees',()=>{
  const brief=validateIdeaBrief(validReply({recommended_assignees:['CODE-01','OWNER','UNKNOWN','QA-01']}));
  assert.deepEqual(brief.recommended_assignees,['CODE-01','QA-01']);
});

test('IDEA-01 rejects wrong assignee before model call',async()=>{
  let called=0;
  await assert.rejects(
    ()=>runIdeaBrain(stateFor({assigned_to:'CODE-01'}),{
      taskId:'IDEA-TASK-001',
      fetchImpl:async()=>{called++;return fakeFetch(validReply())();}
    }),
    /cannot process task assigned to CODE-01/
  );
  assert.equal(called,0);
});

test('IDEA-01 rejects tasks not assigned by ATLAS',async()=>{
  await assert.rejects(
    ()=>runIdeaBrain(stateFor({created_by:'OWNER'}),{
      taskId:'IDEA-TASK-001',
      fetchImpl:fakeFetch(validReply())
    }),
    /must be assigned by ATLAS/
  );
});

test('IDEA-01 requires local model endpoint',async()=>{
  await assert.rejects(
    ()=>runIdeaBrain(stateFor(),{
      taskId:'IDEA-TASK-001',
      fetchImpl:fakeFetch(validReply()),
      url:'https://example.com'
    }),
    /requires a local Ollama endpoint/
  );
});

test('IDEA-01 rejects incomplete briefs',()=>{
  assert.throws(()=>validateIdeaBrief({summary:'x'}),/problem is required/);
});
