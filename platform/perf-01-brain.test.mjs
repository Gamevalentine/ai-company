import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { computeMetricDeltas, hardPerfChecks, enforcePerfVerdict, runPerfBrain } from './perf-01-brain.mjs';

function fakeFetch(reply){
  return async()=>({
    ok:true,
    json:async()=>({model:'perf-test-model',message:{content:JSON.stringify(reply)}}),
    text:async()=>''
  });
}
function measurement(value){
  return {
    available:true,
    method:'lighthouse-ci',
    environment:'staging-build-123',
    device:'mobile',
    network:'simulated-4g',
    repeat_count:3,
    measurements:[
      {metric:'LCP',value,unit:'ms',lower_is_better:true},
      {metric:'CLS',value:0.05,unit:'score',lower_is_better:true}
    ]
  };
}
function perfEvidence({before=3000,after=2200,comparable=true}={}){
  return {
    baseline:measurement(before),
    after:measurement(after),
    comparable_conditions:comparable,
    regression_checks:{
      functional_pass:true,
      visual_pass:true,
      security_pass:true,
      seo_pass:true
    }
  };
}
function reply(overrides={}){
  return {
    status:'READY_FOR_CEO_REVIEW',
    summary:'Comparable evidence shows improved LCP without a detected regression.',
    target:'Improve LCP on the assigned route.',
    root_cause:'The supplied evidence points to excessive render-path latency.',
    bottlenecks:['Render-path latency'],
    recommendations:['Have CODE-01 implement the narrowest verified optimization.'],
    verification_notes:['Compare the same route under the same measurement profile.'],
    remaining_risks:['Lab data may not equal real-user field data.'],
    rollback_path:'Revert only the performance change if regression checks fail.',
    recommended_next_role:'CODE-01',
    owner_decision_required:false,
    owner_decision_reason:'',
    ...overrides
  };
}
function stateFor({evidence=perfEvidence(),assigned_to='PERF-01',created_by='ATLAS'}={}){
  return {
    tasks:[{
      task_id:'PERF-TASK-001',
      project:'AION-HQ',
      created_by,
      assigned_to,
      objective:'Improve page performance',
      scope:'Performance analysis only',
      acceptance_criteria:['Provide evidence-based performance recommendation'],
      status:'QUEUED',
      inputs:{performance_evidence:evidence},
      outputs:{},
      evidence:[]
    }],
    messages:[],memories:[],executions:[],audit:[]
  };
}

test('PERF-01 is a direct ATLAS report',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aion-perf-'));
  const p=new AionPlatform({dataDir:dir});
  const perf=p.agent('PERF-01');
  assert.equal(perf.reports_to,'ATLAS');
  assert.ok(p.agent('ATLAS').can_assign_to.includes('PERF-01'));
  assert.ok(perf.prohibited_actions.includes('production_deploy'));
});

test('metric delta correctly recognizes lower-is-better improvement',()=>{
  const out=computeMetricDeltas(measurement(3000),measurement(2200));
  const lcp=out.deltas.find(x=>x.metric==='LCP');
  assert.equal(lcp.before,3000);
  assert.equal(lcp.after,2200);
  assert.equal(lcp.improved,true);
  assert.equal(lcp.regressed,false);
});

test('PERF-01 produces traceable performance handoff to ATLAS',async()=>{
  const out=await runPerfBrain(stateFor(),{
    taskId:'PERF-TASK-001',
    fetchImpl:fakeFetch(reply())
  });
  const task=out.state.tasks[0];
  assert.equal(task.status,'READY_FOR_CEO_REVIEW');
  assert.equal(task.outputs.performance_handoff.agent_id,'PERF-01');
  assert.equal(task.outputs.performance_handoff.model,'perf-test-model');
  assert.equal(task.outputs.performance_handoff.claims_direct_benchmark_execution,false);
  assert.ok(task.evidence.some(e=>e.type==='PERFORMANCE_HANDOFF'));
  assert.ok(out.state.messages.some(m=>m.from==='PERF-01'&&m.to==='ATLAS'&&m.type==='PERFORMANCE_HANDOFF_READY'));
});

test('missing baseline forces NEEDS_MEASUREMENT even if model claims improvement',async()=>{
  const evidence=perfEvidence();
  evidence.baseline={available:false,measurements:[]};
  const out=await runPerfBrain(stateFor({evidence}),{
    taskId:'PERF-TASK-001',
    fetchImpl:fakeFetch(reply())
  });
  assert.equal(out.report.status,'NEEDS_MEASUREMENT');
  assert.equal(out.report.hard_gate_overrode_model,true);
  assert.ok(out.state.messages.some(m=>m.type==='PERFORMANCE_MEASUREMENT_REQUIRED'));
});

test('comparable regression overrides optimistic model result',async()=>{
  const out=await runPerfBrain(stateFor({evidence:perfEvidence({before:2200,after:3100})}),{
    taskId:'PERF-TASK-001',
    fetchImpl:fakeFetch(reply())
  });
  assert.equal(out.report.status,'NEEDS_ATTENTION');
  assert.equal(out.report.hard_gate_overrode_model,true);
  assert.ok(out.report.metric_deltas.some(d=>d.metric==='LCP'&&d.regressed));
});

test('non-comparable before/after cannot verify improvement claim',()=>{
  const checks=hardPerfChecks(perfEvidence({comparable:false}));
  const g=enforcePerfVerdict(reply(),checks);
  assert.equal(g.status,'NEEDS_MEASUREMENT');
});

test('PERF-01 rejects wrong assignee before model call',async()=>{
  let called=0;
  await assert.rejects(
    ()=>runPerfBrain(stateFor({assigned_to:'CODE-01'}),{
      taskId:'PERF-TASK-001',
      fetchImpl:async()=>{called++;return fakeFetch(reply())();}
    }),
    /cannot process task assigned to CODE-01/
  );
  assert.equal(called,0);
});

test('PERF-01 rejects tasks not assigned by ATLAS',async()=>{
  await assert.rejects(
    ()=>runPerfBrain(stateFor({created_by:'OWNER'}),{
      taskId:'PERF-TASK-001',
      fetchImpl:fakeFetch(reply())
    }),
    /must be assigned by ATLAS/
  );
});

test('PERF-01 requires a local model endpoint',async()=>{
  await assert.rejects(
    ()=>runPerfBrain(stateFor(),{
      taskId:'PERF-TASK-001',
      fetchImpl:fakeFetch(reply()),
      url:'https://example.com'
    }),
    /requires a local Ollama endpoint/
  );
});
