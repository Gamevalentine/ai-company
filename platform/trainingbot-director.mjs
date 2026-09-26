import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_MODEL=process.env.AION_LOCAL_MODEL||'qwen2.5:1.5b-instruct';
const DEFAULT_URL=process.env.OLLAMA_URL||'http://127.0.0.1:11434';

export const TRAININGBOT_SPECIALISTS=[
  'DEV-TB-01',
  'QA-TB-01',
  'SEO-TB-01',
  'CONTENT-TB-01',
  'SECURITY-TB-01',
  'OPS-TB-01',
  'ANALYTICS-TB-01',
  'PUBLISHER-TB-01',
  'COMMS-TB-01'
];

const DIRECTOR_SCHEMA={
  type:'object',
  properties:{
    summary:{type:'string',maxLength:300},
    priority:{type:'string',enum:['low','normal','high','urgent']},
    assignments:{
      type:'array',
      minItems:1,
      maxItems:9,
      items:{
        type:'object',
        properties:{
          agent_id:{type:'string',enum:TRAININGBOT_SPECIALISTS},
          objective:{type:'string',maxLength:320},
          acceptance_criteria:{
            type:'array',
            minItems:1,
            maxItems:6,
            items:{type:'string',maxLength:220}
          },
          requires_qa:{type:'boolean'},
          depends_on:{type:'array',maxItems:4,items:{type:'string',enum:TRAININGBOT_SPECIALISTS}}
        },
        required:['agent_id','objective','acceptance_criteria','requires_qa','depends_on']
      }
    },
    owner_approval_required:{type:'boolean'},
    escalation_reason:{type:'string',maxLength:300},
    coordination_notes:{type:'array',maxItems:8,items:{type:'string',maxLength:220}}
  },
  required:['summary','priority','assignments','owner_approval_required','escalation_reason','coordination_notes']
};

function now(){ return new Date().toISOString(); }
function uid(prefix){ return prefix+'-'+crypto.randomUUID(); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }
function ensureArrays(s){
  for(const k of ['tasks','messages','memories','executions','audit']) if(!Array.isArray(s[k])) s[k]=[];
  return s;
}
function addAudit(s,entry){ s.audit.push({audit_id:uid('AUD'),at:now(),...entry}); }
function addMessage(s,{task_id,from,to,type,payload={}}){
  if(s.messages.some(m=>m.task_id===task_id&&m.from===from&&m.to===to&&m.type===type)) return;
  s.messages.push({message_id:uid('MSG'),task_id,from,to,type,payload,created_at:now(),read_at:null});
}
function rootTask(s,taskId){
  const t=s.tasks.find(x=>x.task_id===taskId);
  if(!t) throw new Error('Root task not found: '+taskId);
  if(t.assigned_to!=='TB-01') throw new Error('Director task must be assigned to TB-01');
  return t;
}

async function ollamaJson({system,user,schema,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}){
  let lastError=null;
  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),120000);
    try{
      const res=await fetchImpl(url+'/api/chat',{
        method:'POST',
        headers:{'content-type':'application/json'},
        signal:controller.signal,
        body:JSON.stringify({
          model,
          stream:false,
          format:schema,
          options:{temperature:0,num_predict:1200},
          messages:[{role:'system',content:system},{role:'user',content:user}]
        })
      });
      if(!res.ok) throw new Error('Ollama '+res.status+': '+await res.text());
      const out=await res.json();
      const content=out?.message?.content;
      if(!content) throw new Error('Ollama returned empty content');
      return {parsed:JSON.parse(content),model:out.model||model,attempt};
    }catch(error){
      lastError=error;
      if(attempt<2) await new Promise(r=>setTimeout(r,1500));
    }finally{
      clearTimeout(timer);
    }
  }
  throw new Error('Director brain failed after 2 attempts: '+(lastError?.message||String(lastError)));
}

export function validateDirectorPlan(plan){
  if(!plan||typeof plan!=='object') throw new Error('Invalid director plan');
  if(!['low','normal','high','urgent'].includes(plan.priority)) throw new Error('Invalid priority');
  if(!Array.isArray(plan.assignments)||plan.assignments.length===0||plan.assignments.length>9) throw new Error('Assignments required');
  const seen=new Set();
  for(const item of plan.assignments){
    if(!TRAININGBOT_SPECIALISTS.includes(item.agent_id)) throw new Error('Unknown TrainingBot specialist: '+item.agent_id);
    if(seen.has(item.agent_id)) throw new Error('Duplicate specialist assignment: '+item.agent_id);
    seen.add(item.agent_id);
    if(typeof item.objective!=='string'||item.objective.trim().length<5) throw new Error('Specialist objective missing: '+item.agent_id);
    if(!Array.isArray(item.acceptance_criteria)||item.acceptance_criteria.length===0) throw new Error('Acceptance criteria missing: '+item.agent_id);
    if(!Array.isArray(item.depends_on)) throw new Error('depends_on missing: '+item.agent_id);
    for(const dep of item.depends_on){
      if(!TRAININGBOT_SPECIALISTS.includes(dep)) throw new Error('Unknown dependency: '+dep);
      if(dep===item.agent_id) throw new Error('Self dependency: '+dep);
    }
  }
  return plan;
}

export async function directorPlan(inputState,{taskId,fetchImpl=fetch}){
  const s=ensureArrays(clone(inputState));
  const root=rootTask(s,taskId);

  const system=[
    'You are TB-01, Director of the TrainingBot office in AION HQ.',
    'You report only to ATLAS CEO. You do not perform specialist work yourself.',
    'Your direct staff are DEV-TB-01, QA-TB-01, SEO-TB-01, CONTENT-TB-01, SECURITY-TB-01, OPS-TB-01, ANALYTICS-TB-01, PUBLISHER-TB-01, COMMS-TB-01.',
    'Choose only the staff actually needed. You may assign several staff in parallel.',
    'DEV handles source/sandbox changes. QA independently verifies changes/evidence. SEO audits search optimization. CONTENT drafts/audits content. SECURITY audits security. OPS monitors health/logs/incidents. ANALYTICS analyzes aggregated metrics. PUBLISHER prepares/distributes approved content. COMMS handles support email and approved community replies.',
    'Any production deploy/merge, DNS, secrets, account credential changes, deletion, paid campaign/spend, refund, legal commitment, or sensitive-data release requires Owner approval. If the requested goal needs one of those, set owner_approval_required=true.',
    'Do not bypass ATLAS or Owner. Do not invent evidence. Do not assign work to yourself.',
    'For source changes, include QA-TB-01 as an independent assignment or mark the DEV assignment requires_qa=true.',
    'For external publishing/messaging, use only approved content and connected channels; no paid actions.',
    'Return only structured JSON matching the schema.'
  ].join('\n');

  const user=JSON.stringify({
    objective:root.objective,
    scope:root.scope,
    acceptance_criteria:root.acceptance_criteria,
    risk_level:root.risk_level,
    current_status:root.status
  });

  const {parsed,model}=await ollamaJson({system,user,schema:DIRECTOR_SCHEMA,fetchImpl});
  const plan=validateDirectorPlan(parsed);

  root.outputs=root.outputs||{};
  root.outputs.director_plan={...plan,model,created_at:now()};
  root.updated_at=now();

  if(plan.owner_approval_required){
    root.status='WAITING_OWNER_APPROVAL';
    root.approval_state='PENDING_OWNER';
    addMessage(s,{
      task_id:root.task_id,
      from:'TB-01',
      to:'ATLAS',
      type:'DIRECTOR_OWNER_APPROVAL_REQUIRED',
      payload:{reason:plan.escalation_reason,summary:plan.summary}
    });
    addAudit(s,{actor:'TB-01',action:'DIRECTOR_PLAN',task_id:root.task_id,target:'ATLAS',result:'WAITING_OWNER_APPROVAL',model});
    s.updated_at=now();
    return {state:s,plan};
  }

  root.status='DIRECTOR_DISPATCHED';
  root.approval_state='NOT_REQUIRED';

  for(const [index,item] of plan.assignments.entries()){
    const childId=taskId+'-OFFICE-'+String(index+1).padStart(2,'0')+'-'+item.agent_id;
    let child=s.tasks.find(t=>t.task_id===childId);
    if(!child){
      child={
        task_id:childId,
        parent_task_id:taskId,
        project:'TrainingBot',
        created_by:'TB-01',
        assigned_to:item.agent_id,
        objective:item.objective,
        scope:root.scope||'TrainingBot',
        acceptance_criteria:item.acceptance_criteria,
        risk_level:root.risk_level||'low',
        status:'QUEUED',
        approval_state:'NOT_REQUIRED',
        inputs:{
          priority:plan.priority,
          requires_qa:item.requires_qa,
          depends_on:item.depends_on,
          director_model:model
        },
        outputs:{},
        evidence:[],
        created_at:now(),
        updated_at:now()
      };
      s.tasks.push(child);
    }
    addMessage(s,{
      task_id:childId,
      from:'TB-01',
      to:item.agent_id,
      type:'DIRECTOR_ASSIGNMENT',
      payload:{parent_task_id:taskId,priority:plan.priority,objective:item.objective,depends_on:item.depends_on}
    });
    addAudit(s,{actor:'TB-01',action:'DIRECTOR_ASSIGN',task_id:childId,target:item.agent_id,result:'QUEUED'});
  }

  addMessage(s,{
    task_id:root.task_id,
    from:'TB-01',
    to:'ATLAS',
    type:'DIRECTOR_PLAN_READY',
    payload:{priority:plan.priority,assignments:plan.assignments.map(x=>x.agent_id),summary:plan.summary}
  });
  addAudit(s,{actor:'TB-01',action:'DIRECTOR_PLAN',task_id:root.task_id,target:'ATLAS',result:'DISPATCHED',model});
  s.updated_at=now();
  return {state:s,plan};
}

const SUCCESS_STATUSES=new Set(['COMPLETED','QA_PASS','EXECUTION_PASSED','REPORT_READY','READY_FOR_MANAGER_REVIEW']);
const FAILURE_STATUSES=new Set(['FAILED','QA_FAIL','EXECUTION_FAILED','NEEDS_REWORK']);

export function directorReview(inputState,{taskId}){
  const s=ensureArrays(clone(inputState));
  const root=rootTask(s,taskId);
  const children=s.tasks.filter(t=>t.parent_task_id===taskId);

  if(root.status==='WAITING_OWNER_APPROVAL'){
    return {state:s,review:{status:'WAITING_OWNER_APPROVAL',children:[]}};
  }

  if(children.length===0){
    root.status='WAITING_EVIDENCE';
  }else if(children.some(t=>FAILURE_STATUSES.has(t.status))){
    root.status='NEEDS_REWORK';
  }else if(children.every(t=>SUCCESS_STATUSES.has(t.status))){
    root.status='READY_FOR_CEO_REVIEW';
    addMessage(s,{
      task_id:root.task_id,
      from:'TB-01',
      to:'ATLAS',
      type:'DIRECTOR_FINAL_REPORT',
      payload:{
        status:'PASS',
        child_statuses:children.map(t=>({task_id:t.task_id,agent_id:t.assigned_to,status:t.status}))
      }
    });
  }else{
    root.status='IN_PROGRESS';
  }

  root.updated_at=now();
  const review={
    status:root.status,
    children:children.map(t=>({
      task_id:t.task_id,
      agent_id:t.assigned_to,
      status:t.status,
      evidence_count:Array.isArray(t.evidence)?t.evidence.length:0
    }))
  };
  root.outputs=root.outputs||{};
  root.outputs.director_review={...review,reviewed_at:now()};
  addAudit(s,{actor:'TB-01',action:'DIRECTOR_REVIEW',task_id:root.task_id,target:'ATLAS',result:root.status});
  s.updated_at=now();
  return {state:s,review};
}

export function directorSummary(state,taskId){
  const root=state.tasks.find(t=>t.task_id===taskId);
  if(!root) return {task_id:taskId,status:'NOT_FOUND'};
  return {
    task_id:root.task_id,
    status:root.status,
    priority:root.outputs?.director_plan?.priority||null,
    plan:root.outputs?.director_plan||null,
    review:root.outputs?.director_review||null,
    children:state.tasks
      .filter(t=>t.parent_task_id===taskId)
      .map(t=>({task_id:t.task_id,assigned_to:t.assigned_to,status:t.status,objective:t.objective}))
  };
}

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const cmd=process.argv[2];
  const statePath=arg('--state');
  const taskId=arg('--task-id');
  const output=arg('--output');
  if(!statePath||!taskId) throw new Error('Missing --state or --task-id');
  const current=JSON.parse(fs.readFileSync(statePath,'utf8'));

  if(cmd==='plan'){
    const next=(await directorPlan(current,{taskId})).state;
    fs.writeFileSync(statePath,JSON.stringify(next,null,2)+'\n');
  }else if(cmd==='review'){
    const out=directorReview(current,{taskId});
    fs.writeFileSync(statePath,JSON.stringify(out.state,null,2)+'\n');
  }else if(cmd==='summary'){
    const out=directorSummary(current,taskId);
    if(output) fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
    else console.log(JSON.stringify(out,null,2));
  }else{
    throw new Error('Unknown command: '+cmd);
  }
}
