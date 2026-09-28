import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { hardOps01Checks, enforceOps01Verdict, runOps01Brain } from './ops-01-brain.mjs';

function fakeFetch(reply){
  return async()=>({
    ok:true,
    json:async()=>({model:'ops01-test-model',message:{content:JSON.stringify(reply)}}),
    text:async()=>''
  });
}
function healthyEvidence(overrides={}){
  return {
    target:'AION HQ',
    requested_action:'HEALTH_CHECK',
    version:'abc123',
    health:{
      routes:[
        {path:'/',http_code:200},
        {path:'/status',http_code:200}
      ]
    },
    recent_workflow_runs:[
      {status:'completed',conclusion:'success'}
    ],
    deployment:{completed:false,status:'not-run',expected_sha:'abc123',actual_sha:'',post_deploy_verified:false},
    approvals:{owner_production_approval:false},
    rollback:{plan_ready:true,target:'previous-good-sha'},
    backup:{required:false},
    blockers:{critical_security:false,critical_qa:false},
    ...overrides
  };
}
function reply(overrides={}){
  return {
    status:'READY_FOR_CEO_REVIEW',
    severity:'info',
    summary:'Supplied health evidence shows the monitored routes are reachable.',
    task_class:'HEALTH_CHECK',
    findings:['Both monitored routes returned successful HTTP status evidence.'],
    proposed_actions:['No production action is required from this review.'],
    verification_steps:['Repeat health checks after the next authorized release.'],
    rollback_plan:'Use the documented previous-good version if a later authorized release fails verification.',
    recommended_next_role:'NONE',
    owner_decision_required:false,
    owner_decision_reason:'',
    ...overrides
  };
}
function stateFor({opsEvidence=healthyEvidence(),assigned_to='OPS-01',created_by='ATLAS'}={}){
  return {
    tasks:[{
      task_id:'OPS01-TASK-001',
      project:'AION-HQ',
      created_by,
      assigned_to,
      objective:'Review operational state',
      scope:'Operations evidence review',
      acceptance_criteria:['Return evidence-backed operational status'],
      status:'QUEUED',
      inputs:{operational_evidence:opsEvidence},
      outputs:{},
      evidence:[]
    }],
    messages:[],memories:[],executions:[],audit:[]
  };
}

test('OPS-01 is a direct ATLAS report',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aion-ops01-'));
  const p=new AionPlatform({dataDir:dir});
  const ops=p.agent('OPS-01');
  assert.equal(ops.reports_to,'ATLAS');
  assert.ok(p.agent('ATLAS').can_assign_to.includes('OPS-01'));
  assert.ok(ops.prohibited_actions.includes('production_deploy'));
  assert.ok(ops.prohibited_actions.includes('dns_change'));
});

test('healthy route evidence can be reviewed without production authority',async()=>{
  const out=await runOps01Brain(stateFor(),{
    taskId:'OPS01-TASK-001',
    fetchImpl:fakeFetch(reply())
  });
  assert.equal(out.state.tasks[0].status,'READY_FOR_CEO_REVIEW');
  assert.equal(out.report.agent_id,'OPS-01');
  assert.equal(out.report.model,'ops01-test-model');
  assert.equal(out.report.claims_operational_action_performed,false);
  assert.ok(out.state.tasks[0].evidence.some(e=>e.type==='OPERATIONS_HANDOFF'));
  assert.ok(out.state.messages.some(m=>m.from==='OPS-01'&&m.to==='ATLAS'&&m.type==='OPS_HANDOFF_READY'));
});

test('production request without Owner approval stops at approval gate',async()=>{
  const e=healthyEvidence({
    requested_action:'PRODUCTION_DEPLOY',
    approvals:{owner_production_approval:false}
  });
  const out=await runOps01Brain(stateFor({opsEvidence:e}),{
    taskId:'OPS01-TASK-001',
    fetchImpl:fakeFetch(reply({task_class:'DEPLOYMENT',status:'READY_FOR_CEO_REVIEW'}))
  });
  assert.equal(out.report.status,'PREPARED_FOR_APPROVAL');
  assert.equal(out.report.owner_decision_required,true);
  assert.equal(out.state.tasks[0].status,'WAITING_OWNER_APPROVAL');
  assert.ok(out.state.messages.some(m=>m.type==='OPS_OWNER_APPROVAL_REQUIRED'));
});

test('production gate requires target version rollback and relevant backup readiness',()=>{
  const e=healthyEvidence({
    requested_action:'PRODUCTION_DEPLOY',
    approvals:{owner_production_approval:true},
    rollback:{plan_ready:false,target:''},
    backup:{required:true,status_checked:false,available:false}
  });
  const checks=hardOps01Checks(e);
  assert.equal(checks.production_gate.ready,false);
});

test('deployment success claim needs version and post-deploy verification',()=>{
  const e=healthyEvidence({
    deployment:{
      completed:true,
      status:'success',
      expected_sha:'abc123',
      actual_sha:'wrong-sha',
      post_deploy_verified:false
    }
  });
  const gate=enforceOps01Verdict(
    reply({task_class:'DEPLOYMENT',summary:'Deployment succeeded and is live successfully.'}),
    hardOps01Checks(e)
  );
  assert.equal(gate.status,'NEEDS_EVIDENCE');
  assert.equal(gate.overridden,true);
});

test('failed homepage forces INCIDENT despite optimistic model output',async()=>{
  const e=healthyEvidence();
  e.health.routes[0].http_code=503;
  const out=await runOps01Brain(stateFor({opsEvidence:e}),{
    taskId:'OPS01-TASK-001',
    fetchImpl:fakeFetch(reply({status:'HEALTHY',summary:'System is healthy.'}))
  });
  assert.equal(out.report.status,'INCIDENT');
  assert.equal(out.report.severity,'critical');
  assert.equal(out.state.tasks[0].status,'INCIDENT');
  assert.ok(out.state.messages.some(m=>m.type==='OPS_INCIDENT_ALERT'));
});

test('partial route failure forces DEGRADED',async()=>{
  const e=healthyEvidence();
  e.health.routes[1].http_code=500;
  const out=await runOps01Brain(stateFor({opsEvidence:e}),{
    taskId:'OPS01-TASK-001',
    fetchImpl:fakeFetch(reply({status:'HEALTHY',summary:'System is healthy.'}))
  });
  assert.equal(out.report.status,'DEGRADED');
  assert.equal(out.state.tasks[0].status,'DEGRADED');
});

test('backup usability claim requires restore-readiness evidence',()=>{
  const e=healthyEvidence({
    backup:{required:true,status_checked:true,available:true,restore_readiness_checked:false}
  });
  const gate=enforceOps01Verdict(
    reply({summary:'Backup is usable and restorable.'}),
    hardOps01Checks(e)
  );
  assert.equal(gate.status,'NEEDS_EVIDENCE');
});

test('OPS-01 rejects wrong assignee before model call',async()=>{
  let called=0;
  await assert.rejects(
    ()=>runOps01Brain(stateFor({assigned_to:'CODE-01'}),{
      taskId:'OPS01-TASK-001',
      fetchImpl:async()=>{called++;return fakeFetch(reply())();}
    }),
    /cannot process task assigned to CODE-01/
  );
  assert.equal(called,0);
});

test('OPS-01 rejects tasks not assigned by ATLAS',async()=>{
  await assert.rejects(
    ()=>runOps01Brain(stateFor({created_by:'OWNER'}),{
      taskId:'OPS01-TASK-001',
      fetchImpl:fakeFetch(reply())
    }),
    /must be assigned by ATLAS/
  );
});

test('OPS-01 requires local model endpoint',async()=>{
  await assert.rejects(
    ()=>runOps01Brain(stateFor(),{
      taskId:'OPS01-TASK-001',
      fetchImpl:fakeFetch(reply()),
      url:'https://example.com'
    }),
    /requires a local Ollama endpoint/
  );
});
