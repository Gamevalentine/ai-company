import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { hardQaChecks, enforceQaVerdict, runQa01Brain } from './qa-01-brain.mjs';

function fakeFetch(reply){
  return async()=>({
    ok:true,
    json:async()=>({model:'qa01-test-model',message:{content:JSON.stringify(reply)}}),
    text:async()=>''
  });
}

function evidence(overrides={}){
  return {
    version:{commit:'abc123',branch:'feature/test',artifact:'build-abc123',url:''},
    changed_behavior_exercised:true,
    responsive_checked:true,
    refresh_navigation_checked:true,
    accessibility_checked:true,
    criterion_results:[
      {id:'AC-01',status:'PASS',executed:true,evidence:'Test run T1 passed on build-abc123.'},
      {id:'AC-02',status:'PASS',executed:true,evidence:'Test run T2 passed on build-abc123.'}
    ],
    test_runs:[
      {name:'Primary flow',status:'PASS',executed:true,evidence:'T1'},
      {name:'Regression flow',status:'PASS',executed:true,evidence:'T2'}
    ],
    defects:[],
    ...overrides
  };
}

function reply(overrides={}){
  return {
    verdict:'PASS',
    summary:'All supplied acceptance-criterion evidence passes for the identified build.',
    test_scope:['Primary flow','Regression flow','Refresh/navigation','Responsive behavior'],
    findings:[],
    regression_risks:['Only the supplied scope was verified.'],
    evidence_gaps:[],
    recommended_next_role:'NONE',
    ...overrides
  };
}

function stateFor({qaEvidence=evidence(),assigned_to='QA-01',created_by='ATLAS'}={}){
  return {
    tasks:[{
      task_id:'QA01-TASK-001',
      project:'AION-HQ',
      created_by,
      assigned_to,
      objective:'Verify assigned change',
      scope:'Independent QA',
      acceptance_criteria:[
        {id:'AC-01',description:'Primary flow works as requested.'},
        {id:'AC-02',description:'Changed path has no material regression.'}
      ],
      status:'QUEUED',
      inputs:{qa_evidence:qaEvidence},
      outputs:{},
      evidence:[]
    }],
    messages:[],memories:[],executions:[],audit:[]
  };
}

test('QA-01 is a direct independent ATLAS report',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aion-qa01-'));
  const p=new AionPlatform({dataDir:dir});
  const qa=p.agent('QA-01');
  assert.equal(qa.reports_to,'ATLAS');
  assert.ok(p.agent('ATLAS').can_assign_to.includes('QA-01'));
  assert.ok(qa.prohibited_actions.includes('edit_source'));
  assert.ok(qa.prohibited_actions.includes('change_acceptance_criteria'));
});

test('complete evidence allows PASS',async()=>{
  const out=await runQa01Brain(stateFor(),{
    taskId:'QA01-TASK-001',
    fetchImpl:fakeFetch(reply())
  });
  assert.equal(out.report.verdict,'PASS');
  assert.equal(out.state.tasks[0].status,'QA_PASS');
  assert.equal(out.report.model,'qa01-test-model');
  assert.equal(out.report.claims_direct_test_execution,false);
  assert.ok(out.state.tasks[0].evidence.some(e=>e.type==='QA_HANDOFF'));
  assert.ok(out.state.messages.some(m=>m.from==='QA-01'&&m.to==='ATLAS'&&m.type==='QA_PASS_READY'));
});

test('missing exact tested version blocks PASS',async()=>{
  const e=evidence({version:{commit:'',branch:'',artifact:'',url:''}});
  const out=await runQa01Brain(stateFor({qaEvidence:e}),{
    taskId:'QA01-TASK-001',
    fetchImpl:fakeFetch(reply())
  });
  assert.equal(out.report.verdict,'BLOCKED');
  assert.equal(out.state.tasks[0].status,'QA_BLOCKED');
});

test('unexecuted acceptance criterion blocks PASS',()=>{
  const e=evidence();
  e.criterion_results[1]={id:'AC-02',status:'PASS',executed:false,evidence:''};
  const task=stateFor({qaEvidence:e}).tasks[0];
  const checks=hardQaChecks(task,e);
  const gate=enforceQaVerdict(reply(),checks);
  assert.equal(gate.verdict,'BLOCKED');
  assert.ok(checks.unverified_criteria.includes('AC-02'));
});

test('failed criterion forces FAIL despite optimistic model',async()=>{
  const e=evidence();
  e.criterion_results[0]={id:'AC-01',status:'FAIL',executed:true,evidence:'Primary flow returned wrong state.'};
  const out=await runQa01Brain(stateFor({qaEvidence:e}),{
    taskId:'QA01-TASK-001',
    fetchImpl:fakeFetch(reply())
  });
  assert.equal(out.report.verdict,'FAIL');
  assert.equal(out.state.tasks[0].status,'QA_FAIL');
  assert.ok(out.state.messages.some(m=>m.type==='QA_FAIL_REPORTED'));
});

test('open P0/P1 defect forces FAIL',()=>{
  const e=evidence({
    defects:[{id:'BUG-01',severity:'P1',open:true,summary:'Core action broken',evidence:'Reproduced in T3'}]
  });
  const task=stateFor({qaEvidence:e}).tasks[0];
  const gate=enforceQaVerdict(reply(),hardQaChecks(task,e));
  assert.equal(gate.verdict,'FAIL');
});

test('changed behavior must actually be exercised before PASS',()=>{
  const e=evidence({changed_behavior_exercised:false});
  const task=stateFor({qaEvidence:e}).tasks[0];
  const gate=enforceQaVerdict(reply(),hardQaChecks(task,e));
  assert.equal(gate.verdict,'BLOCKED');
});

test('QA-01 rejects wrong assignee before model call',async()=>{
  let called=0;
  await assert.rejects(
    ()=>runQa01Brain(stateFor({assigned_to:'CODE-01'}),{
      taskId:'QA01-TASK-001',
      fetchImpl:async()=>{called++;return fakeFetch(reply())();}
    }),
    /cannot process task assigned to CODE-01/
  );
  assert.equal(called,0);
});

test('QA-01 rejects tasks not assigned by ATLAS',async()=>{
  await assert.rejects(
    ()=>runQa01Brain(stateFor({created_by:'OWNER'}),{
      taskId:'QA01-TASK-001',
      fetchImpl:fakeFetch(reply())
    }),
    /must be assigned by ATLAS/
  );
});

test('QA-01 requires local model endpoint',async()=>{
  await assert.rejects(
    ()=>runQa01Brain(stateFor(),{
      taskId:'QA01-TASK-001',
      fetchImpl:fakeFetch(reply()),
      url:'https://example.com'
    }),
    /requires a local Ollama endpoint/
  );
});
