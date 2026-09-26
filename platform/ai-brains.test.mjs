import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, applyEvent } from './event-worker.mjs';
import { bootstrapAiPilot, managerPlan, prepareAiDevQueue, hardQaChecks, enforceQaVerdict, qaReview } from './ai-brains.mjs';

function fakeOllama(content){
  return async()=>({ok:true,json:async()=>({model:'test-model',message:{content:JSON.stringify(content)}}),text:async()=>''});
}

test('AI manager can interpret natural task but permission guard blocks owner-approval plan',async()=>{
  const s=bootstrapAiPilot(createEmptyState());
  await assert.rejects(
    managerPlan(s,{taskId:'AION-AI-PILOT-001',fetchImpl:fakeOllama({
      summary:'deploy it',
      operation:'validate-sandbox',
      dev_objective:'Deploy production now',
      qa_focus:['check'],
      needs_owner_approval:true,
      risk_reason:'production'
    })}),
    /owner-approval/
  );
});

test('AI manager creates DEV task only through TB-01 and allowed sandbox operation',async()=>{
  let s=bootstrapAiPilot(createEmptyState());
  s=(await managerPlan(s,{taskId:'AION-AI-PILOT-001',fetchImpl:fakeOllama({
    summary:'sandbox build verification',
    operation:'validate-sandbox',
    dev_objective:'Build and validate TrainingBot sandbox without production changes',
    qa_focus:['verify run URL','verify commit SHA'],
    needs_owner_approval:false,
    risk_reason:'low-risk sandbox validation'
  })})).state;
  const dev=s.tasks.find(t=>t.assigned_to==='DEV-TB-01');
  assert.equal(dev.created_by,'TB-01');
  assert.equal(dev.inputs.operation,'validate-sandbox');
  const q=prepareAiDevQueue(s,{taskId:'AION-AI-PILOT-001'});
  assert.equal(q.queue.length,1);
});

test('hard QA gate overrides hallucinated PASS when evidence is missing',()=>{
  const checks=hardQaChecks({
    dev:{status:'EXECUTION_PASSED'},
    execution:{status:'SUCCESS',result:'PASS',branch:'aion-sandbox',operation:'validate-sandbox',run_url:null},
    evidence:{operation:'validate-sandbox',head_sha:null}
  });
  const out=enforceQaVerdict('PASS',checks);
  assert.equal(out.verdict,'FAIL');
  assert.equal(out.overridden,true);
});

test('AI QA PASS requires model PASS and complete hard evidence',async()=>{
  let s=bootstrapAiPilot(createEmptyState());
  s=(await managerPlan(s,{taskId:'AION-AI-PILOT-001',fetchImpl:fakeOllama({
    summary:'verify build',
    operation:'validate-sandbox',
    dev_objective:'Validate sandbox build safely',
    qa_focus:['run URL','commit SHA'],
    needs_owner_approval:false,
    risk_reason:'sandbox only'
  })})).state;
  const q=prepareAiDevQueue(s,{taskId:'AION-AI-PILOT-001'});
  s=q.state;
  const devId=q.queue[0].task_id;
  s=applyEvent(s,'executor_result',{
    task_id:devId,result:'PASS',run_id:'321',
    run_url:'https://github.com/Gamevalentine/trainingbot-cloudflare/actions/runs/321',
    head_sha:'abc123',operation:'validate-sandbox',conclusion:'success'
  });
  s=(await qaReview(s,{taskId:'AION-AI-PILOT-001',fetchImpl:fakeOllama({
    verdict:'PASS',reason:'evidence is complete and sandbox-only',concerns:[]
  })})).state;
  assert.equal(s.tasks.find(t=>t.task_id==='AION-AI-PILOT-001').status,'READY_FOR_CEO_REVIEW');
  assert.ok(s.messages.some(m=>m.to==='ATLAS'&&m.type==='AI_MANAGER_REPORT'));
});


test('AI manager retries malformed local-model output once',async()=>{
  let calls=0;
  const fetchImpl=async()=>{
    calls++;
    if(calls===1) return {ok:true,json:async()=>({model:'test-model',message:{content:'{"summary":"broken"'}}),text:async()=>''};
    return {ok:true,json:async()=>({model:'test-model',message:{content:JSON.stringify({
      summary:'retry recovered',
      operation:'validate-sandbox',
      dev_objective:'Validate the TrainingBot sandbox build',
      qa_focus:['verify run URL','verify commit SHA'],
      needs_owner_approval:false,
      risk_reason:'sandbox only'
    })}}),text:async()=>''};
  };
  const s=bootstrapAiPilot(createEmptyState(),{taskId:'AION-AI-RETRY'});
  const out=await managerPlan(s,{taskId:'AION-AI-RETRY',fetchImpl});
  assert.equal(calls,2);
  assert.equal(out.state.tasks.find(t=>t.task_id==='AION-AI-RETRY').status,'AI_MANAGER_PLANNED');
});
