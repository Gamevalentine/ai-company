import test from 'node:test';
import assert from 'node:assert/strict';
import { hardOpsChecks, enforceOpsVerdict, reviewOpsEvidence } from './ops-brain.mjs';

function mockFetch(reply){
  return async()=>({
    ok:true,
    json:async()=>({model:'ops-test-model',message:{content:JSON.stringify(reply)}}),
    text:async()=>''
  });
}

function evidence(){
  return {
    source:'test',
    github_repo:{full_name:'Gamevalentine/trainingbot-cloudflare'},
    routes:[
      {path:'/',http_code:200,time_total_ms:100},
      {path:'/news',http_code:200,time_total_ms:120},
      {path:'/wiki',http_code:200,time_total_ms:130},
      {path:'/ban-cap-nhat',http_code:200,time_total_ms:140}
    ],
    recent_workflow_runs:[
      {status:'completed',conclusion:'success'},
      {status:'completed',conclusion:'success'}
    ]
  };
}

test('OPS hard checks accept healthy routes',()=>{
  const c=hardOpsChecks(evidence());
  assert.equal(c.homepage_ok,true);
  assert.equal(c.all_routes_ok,true);
  assert.equal(c.github_status_readable,true);
});

test('OPS hard gate forces INCIDENT when homepage is down',()=>{
  const e=evidence();
  e.routes[0].http_code=503;
  const g=enforceOpsVerdict(
    {status:'HEALTHY',severity:'info',recommended_action:'NO_ACTION',needs_manager_attention:false},
    hardOpsChecks(e)
  );
  assert.equal(g.status,'INCIDENT');
  assert.equal(g.severity,'critical');
  assert.equal(g.needs_manager_attention,true);
});

test('OPS hard gate forces DEGRADED when one route fails',()=>{
  const e=evidence();
  e.routes[2].http_code=500;
  const g=enforceOpsVerdict(
    {status:'HEALTHY',severity:'info',recommended_action:'NO_ACTION',needs_manager_attention:false},
    hardOpsChecks(e)
  );
  assert.equal(g.status,'DEGRADED');
  assert.equal(g.recommended_action,'ESCALATE_DEV');
});

test('OPS AI brain accepts supported HEALTHY verdict',async()=>{
  const r=await reviewOpsEvidence(evidence(),{fetchImpl:mockFetch({
    status:'HEALTHY',
    severity:'info',
    summary:'TrainingBot routes are reachable.',
    findings:['All monitored routes returned successful HTTP responses.'],
    recommended_action:'NO_ACTION',
    needs_manager_attention:false
  })});
  assert.equal(r.agent_id,'OPS-TB-01');
  assert.equal(r.status,'HEALTHY');
  assert.equal(r.hard_gate_overrode_model,false);
});

test('OPS cannot hide repeated workflow failures behind HEALTHY',async()=>{
  const e=evidence();
  e.recent_workflow_runs=[
    {status:'completed',conclusion:'failure'},
    {status:'completed',conclusion:'failure'}
  ];
  const r=await reviewOpsEvidence(e,{fetchImpl:mockFetch({
    status:'HEALTHY',
    severity:'info',
    summary:'Routes respond.',
    findings:[],
    recommended_action:'NO_ACTION',
    needs_manager_attention:false
  })});
  assert.equal(r.status,'DEGRADED');
  assert.equal(r.needs_manager_attention,true);
  assert.equal(r.hard_gate_overrode_model,true);
});
