import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, applyEvent } from './event-worker.mjs';
import { directorPlan, directorReview, validateDirectorPlan } from './trainingbot-director.mjs';

function mockFetch(plan){
  return async()=>({
    ok:true,
    json:async()=>({model:'director-test-model',message:{content:JSON.stringify(plan)}}),
    text:async()=>''
  });
}

function baseState(taskId='DIR-001',objective='Manage TrainingBot office task'){
  let s=createEmptyState();
  s=applyEvent(s,'create_task',{
    actor_id:'ATLAS',
    assigned_to:'TB-01',
    task_id:taskId,
    project:'TrainingBot',
    objective,
    scope:'TrainingBot only',
    acceptance_criteria:['Director routes the work correctly'],
    risk_level:'low'
  });
  return s;
}

test('director can route one goal to multiple TrainingBot specialists',async()=>{
  const plan={
    summary:'Prepare content, publish it, and support replies',
    priority:'high',
    assignments:[
      {
        agent_id:'CONTENT-TB-01',
        objective:'Prepare approved TrainingBot announcement copy',
        acceptance_criteria:['Draft is complete','Facts are consistent'],
        requires_qa:false,
        depends_on:[]
      },
      {
        agent_id:'PUBLISHER-TB-01',
        objective:'Prepare approved announcement for connected platforms',
        acceptance_criteria:['Platform formats are ready','No paid campaign is created'],
        requires_qa:false,
        depends_on:['CONTENT-TB-01']
      },
      {
        agent_id:'COMMS-TB-01',
        objective:'Prepare support replies for common questions about the announcement',
        acceptance_criteria:['FAQ replies are ready','Sensitive cases escalate to TB-01'],
        requires_qa:false,
        depends_on:['CONTENT-TB-01']
      }
    ],
    owner_approval_required:false,
    escalation_reason:'',
    coordination_notes:['Publish only approved content']
  };
  const out=await directorPlan(baseState(),{taskId:'DIR-001',fetchImpl:mockFetch(plan)});
  const root=out.state.tasks.find(t=>t.task_id==='DIR-001');
  const children=out.state.tasks.filter(t=>t.parent_task_id==='DIR-001');
  assert.equal(root.status,'DIRECTOR_DISPATCHED');
  assert.deepEqual(children.map(t=>t.assigned_to),['CONTENT-TB-01','PUBLISHER-TB-01','COMMS-TB-01']);
  assert.ok(out.state.messages.some(m=>m.task_id==='DIR-001'&&m.to==='ATLAS'&&m.type==='DIRECTOR_PLAN_READY'));
});

test('director owner gate stops specialist dispatch',async()=>{
  const plan={
    summary:'Production DNS change is requested',
    priority:'urgent',
    assignments:[
      {
        agent_id:'OPS-TB-01',
        objective:'Prepare a non-executing change assessment',
        acceptance_criteria:['Risk is documented'],
        requires_qa:false,
        depends_on:[]
      }
    ],
    owner_approval_required:true,
    escalation_reason:'DNS change requires Owner approval',
    coordination_notes:[]
  };
  const out=await directorPlan(baseState('DIR-002','Change production DNS'),{taskId:'DIR-002',fetchImpl:mockFetch(plan)});
  const root=out.state.tasks.find(t=>t.task_id==='DIR-002');
  assert.equal(root.status,'WAITING_OWNER_APPROVAL');
  assert.equal(root.approval_state,'PENDING_OWNER');
  assert.equal(out.state.tasks.filter(t=>t.parent_task_id==='DIR-002').length,0);
  assert.ok(out.state.messages.some(m=>m.to==='ATLAS'&&m.type==='DIRECTOR_OWNER_APPROVAL_REQUIRED'));
});

test('director rejects unknown or duplicate staff assignments',()=>{
  assert.throws(()=>validateDirectorPlan({
    summary:'bad',
    priority:'normal',
    assignments:[{
      agent_id:'UNKNOWN-TB-01',
      objective:'Do unknown work',
      acceptance_criteria:['x'],
      requires_qa:false,
      depends_on:[]
    }],
    owner_approval_required:false,
    escalation_reason:'',
    coordination_notes:[]
  }),/Unknown TrainingBot specialist/);

  assert.throws(()=>validateDirectorPlan({
    summary:'dup',
    priority:'normal',
    assignments:[
      {agent_id:'SEO-TB-01',objective:'Audit SEO first',acceptance_criteria:['x'],requires_qa:false,depends_on:[]},
      {agent_id:'SEO-TB-01',objective:'Audit SEO again',acceptance_criteria:['x'],requires_qa:false,depends_on:[]}
    ],
    owner_approval_required:false,
    escalation_reason:'',
    coordination_notes:[]
  }),/Duplicate specialist assignment/);
});

test('director review aggregates parallel staff status and reports to ATLAS only when all pass',async()=>{
  const plan={
    summary:'Parallel office audit',
    priority:'normal',
    assignments:[
      {agent_id:'SEO-TB-01',objective:'Audit SEO',acceptance_criteria:['report'],requires_qa:false,depends_on:[]},
      {agent_id:'SECURITY-TB-01',objective:'Audit security',acceptance_criteria:['report'],requires_qa:false,depends_on:[]}
    ],
    owner_approval_required:false,
    escalation_reason:'',
    coordination_notes:[]
  };
  let s=(await directorPlan(baseState('DIR-003','Run office audits'),{taskId:'DIR-003',fetchImpl:mockFetch(plan)})).state;
  let r=directorReview(s,{taskId:'DIR-003'});
  assert.equal(r.review.status,'IN_PROGRESS');

  s=r.state;
  for(const t of s.tasks.filter(t=>t.parent_task_id==='DIR-003')){
    t.status='REPORT_READY';
    t.evidence.push({type:'REPORT',ref:t.assigned_to});
  }
  r=directorReview(s,{taskId:'DIR-003'});
  assert.equal(r.review.status,'READY_FOR_CEO_REVIEW');
  assert.ok(r.state.messages.some(m=>m.task_id==='DIR-003'&&m.to==='ATLAS'&&m.type==='DIRECTOR_FINAL_REPORT'));
});

test('director review sends failed staff work to rework instead of CEO completion',async()=>{
  const plan={
    summary:'Ops and security check',
    priority:'normal',
    assignments:[
      {agent_id:'OPS-TB-01',objective:'Check health',acceptance_criteria:['report'],requires_qa:false,depends_on:[]},
      {agent_id:'SECURITY-TB-01',objective:'Check security',acceptance_criteria:['report'],requires_qa:false,depends_on:[]}
    ],
    owner_approval_required:false,
    escalation_reason:'',
    coordination_notes:[]
  };
  let s=(await directorPlan(baseState('DIR-004','Check service health and security'),{taskId:'DIR-004',fetchImpl:mockFetch(plan)})).state;
  s.tasks.find(t=>t.parent_task_id==='DIR-004'&&t.assigned_to==='OPS-TB-01').status='REPORT_READY';
  s.tasks.find(t=>t.parent_task_id==='DIR-004'&&t.assigned_to==='SECURITY-TB-01').status='FAILED';
  const r=directorReview(s,{taskId:'DIR-004'});
  assert.equal(r.review.status,'NEEDS_REWORK');
  assert.equal(r.state.messages.some(m=>m.task_id==='DIR-004'&&m.type==='DIRECTOR_FINAL_REPORT'),false);
});
