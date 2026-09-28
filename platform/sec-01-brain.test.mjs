import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { hardSecChecks, enforceSecVerdict, runSecBrain } from './sec-01-brain.mjs';

function mockFetch(reply){
  return async()=>({
    ok:true,
    json:async()=>({model:'sec-test-model',message:{content:JSON.stringify(reply)}}),
    text:async()=>''
  });
}
function cleanEvidence(){
  return {
    static_scan:{private_key_files:0,committed_env_files:0,credential_like_files:0},
    dependency_audit:{available:true,critical:0,high:0},
    headers:{available:true,strict_transport_security:true,content_security_policy:true,x_content_type_options:true},
    auth:{confirmed_bypass:false,confirmed_authorization_bypass:false},
    secrets:{public_exposure:false},
    data_exposure:{sensitive_public:false}
  };
}
function aiReply(overrides={}){
  return {
    status:'SECURITY_OK',
    severity:'info',
    summary:'Supplied evidence does not show a confirmed material security issue.',
    evidence_reviewed:['Static scan','Dependency audit','Public headers'],
    findings:[],
    remediation_plan:['Repeat checks after material security changes.'],
    verification_criteria:['No critical/high dependency findings or exposure indicators.'],
    evidence_gaps:[],
    recommended_next_role:'NONE',
    owner_approval_required:false,
    owner_approval_reason:'',
    ...overrides
  };
}
function taskState(evidence,assigned_to='SEC-01'){
  return {
    tasks:[{
      task_id:'SEC-TASK-001',
      project:'TrainingBot',
      created_by:'ATLAS',
      assigned_to,
      objective:'Review security posture',
      scope:'Defensive review',
      acceptance_criteria:['Evidence-based findings'],
      status:'QUEUED',
      inputs:{security_evidence:evidence},
      outputs:{},
      evidence:[]
    }],
    messages:[],memories:[],executions:[],audit:[]
  };
}

test('SEC-01 is an independent direct report of ATLAS',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aion-sec-'));
  const p=new AionPlatform({dataDir:dir});
  const sec=p.agent('SEC-01');
  assert.equal(sec.reports_to,'ATLAS');
  assert.ok(p.agent('ATLAS').can_assign_to.includes('SEC-01'));
  assert.ok(sec.prohibited_actions.includes('secret_change'));
  assert.ok(sec.prohibited_actions.includes('production_deploy'));
});

test('clean evidence does not trigger hard security escalation',()=>{
  const c=hardSecChecks(cleanEvidence());
  assert.equal(c.hard_critical,false);
  assert.equal(c.hard_attention,false);
});

test('public secret exposure forces CRITICAL and Owner approval gate',()=>{
  const e=cleanEvidence();
  e.secrets.public_exposure=true;
  const g=enforceSecVerdict(aiReply(),hardSecChecks(e));
  assert.equal(g.status,'CRITICAL');
  assert.equal(g.recommended_next_role,'CEO');
  assert.equal(g.owner_approval_required,true);
});

test('high dependency finding cannot be reported as SECURITY_OK',()=>{
  const e=cleanEvidence();
  e.dependency_audit.high=1;
  const g=enforceSecVerdict(aiReply(),hardSecChecks(e));
  assert.equal(g.status,'NEEDS_ATTENTION');
  assert.equal(g.recommended_next_role,'CODE-01');
});

test('SEC-01 produces traceable handoff to ATLAS',async()=>{
  const out=await runSecBrain(taskState(cleanEvidence()),{
    taskId:'SEC-TASK-001',
    fetchImpl:mockFetch(aiReply())
  });
  const task=out.state.tasks[0];
  assert.equal(task.status,'READY_FOR_CEO_REVIEW');
  assert.equal(task.outputs.security_handoff.agent_id,'SEC-01');
  assert.equal(task.outputs.security_handoff.model,'sec-test-model');
  assert.ok(out.state.messages.some(m=>m.from==='SEC-01'&&m.to==='ATLAS'&&m.type==='SECURITY_HANDOFF_READY'));
  assert.ok(task.evidence.some(e=>e.type==='SECURITY_HANDOFF'));
});

test('SEC-01 critical hard gate overrides optimistic model output',async()=>{
  const e=cleanEvidence();
  e.auth.confirmed_authorization_bypass=true;
  const out=await runSecBrain(taskState(e),{
    taskId:'SEC-TASK-001',
    fetchImpl:mockFetch(aiReply({findings:['No issue found.']}))
  });
  assert.equal(out.report.status,'CRITICAL');
  assert.equal(out.report.hard_gate_overrode_model,true);
  assert.ok(out.report.findings.some(x=>x.includes('authorization bypass')));
  assert.equal(out.state.tasks[0].status,'SECURITY_CRITICAL');
  assert.ok(out.state.messages.some(m=>m.type==='SECURITY_CRITICAL_ALERT'));
});

test('SEC-01 refuses tasks assigned to another employee',async()=>{
  await assert.rejects(
    ()=>runSecBrain(taskState(cleanEvidence(),'CODE-01'),{
      taskId:'SEC-TASK-001',
      fetchImpl:mockFetch(aiReply())
    }),
    /cannot process task assigned to CODE-01/
  );
});
