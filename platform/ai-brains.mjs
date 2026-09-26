import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_MODEL=process.env.AION_LOCAL_MODEL||'qwen2.5:1.5b-instruct';
const DEFAULT_URL=process.env.OLLAMA_URL||'http://127.0.0.1:11434';

function now(){ return new Date().toISOString(); }
function uid(prefix){ return prefix+'-'+crypto.randomUUID(); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }
function audit(s,entry){ s.audit.push({audit_id:uid('AUD'),at:now(),...entry}); }
function message(s,{task_id,from,to,type,payload={}}){
  if(s.messages.some(m=>m.task_id===task_id&&m.from===from&&m.to===to&&m.type===type)) return;
  s.messages.push({message_id:uid('MSG'),task_id,from,to,type,payload,created_at:now(),read_at:null});
}
function ensureArrays(s){
  for(const k of ['tasks','messages','memories','executions','audit']) if(!Array.isArray(s[k])) s[k]=[];
  return s;
}

const MANAGER_SCHEMA={
  type:'object',
  properties:{
    summary:{type:'string',maxLength:240},
    operation:{type:'string',enum:['validate-sandbox','compare-with-main']},
    dev_objective:{type:'string',maxLength:240},
    qa_focus:{type:'array',items:{type:'string',maxLength:160},minItems:1,maxItems:5},
    needs_owner_approval:{type:'boolean'},
    risk_reason:{type:'string',maxLength:240}
  },
  required:['summary','operation','dev_objective','qa_focus','needs_owner_approval','risk_reason']
};

const QA_SCHEMA={
  type:'object',
  properties:{
    verdict:{type:'string',enum:['PASS','FAIL']},
    reason:{type:'string',maxLength:300},
    concerns:{type:'array',items:{type:'string',maxLength:180},maxItems:6}
  },
  required:['verdict','reason','concerns']
};

async function ollamaChat({system,user,schema,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}){
  const res=await fetchImpl(url+'/api/chat',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      model,
      stream:false,
      format:schema,
      options:{temperature:0,num_predict:768},
      messages:[
        {role:'system',content:system},
        {role:'user',content:user}
      ]
    })
  });
  if(!res.ok) throw new Error('Ollama '+res.status+': '+await res.text());
  const out=await res.json();
  const content=out?.message?.content;
  if(!content) throw new Error('Ollama returned empty content');
  return {parsed:JSON.parse(content),model:out.model||model,raw:content};
}

export function validateManagerDecision(decision){
  if(!decision||typeof decision!=='object') throw new Error('Invalid manager decision');
  if(!['validate-sandbox','compare-with-main'].includes(decision.operation)) throw new Error('Manager operation denied');
  if(typeof decision.dev_objective!=='string'||decision.dev_objective.trim().length<5) throw new Error('Manager DEV objective missing');
  if(!Array.isArray(decision.qa_focus)||decision.qa_focus.length===0) throw new Error('Manager QA focus missing');
  if(decision.needs_owner_approval===true) throw new Error('Pilot cannot execute an owner-approval operation');
  return decision;
}

export function hardQaChecks({dev,execution,evidence}){
  return {
    dev_task_exists:Boolean(dev),
    dev_execution_passed:dev?.status==='EXECUTION_PASSED',
    execution_success:execution?.status==='SUCCESS'&&execution?.result==='PASS',
    sandbox_branch:execution?.branch==='aion-sandbox',
    allowed_operation:['validate-sandbox','compare-with-main'].includes(evidence?.operation||execution?.operation),
    has_run_url:Boolean(evidence?.run_url||execution?.run_url),
    has_commit_sha:Boolean(evidence?.head_sha),
    production_not_requested:(evidence?.operation||execution?.operation)!=='production'
  };
}

export function enforceQaVerdict(modelVerdict,checks){
  const hardPass=Object.values(checks).every(Boolean);
  if(!hardPass) return {verdict:'FAIL',overridden:true,reason:'Hard evidence gate failed'};
  if(modelVerdict!=='PASS') return {verdict:'FAIL',overridden:false,reason:'QA model raised concerns'};
  return {verdict:'PASS',overridden:false,reason:'AI QA verdict and hard evidence gate both passed'};
}

function rootTask(state,taskId){
  const t=state.tasks.find(x=>x.task_id===taskId);
  if(!t) throw new Error('Root task not found: '+taskId);
  return t;
}

export async function managerPlan(inputState,{taskId,fetchImpl=fetch}){
  const s=ensureArrays(clone(inputState));
  const root=rootTask(s,taskId);
  const system=[
    'You are TB-01, the TrainingBot Manager Agent in AION HQ.',
    'You report to ATLAS CEO and delegate technical work to DEV-TB-01 and independent verification to QA-TB-01.',
    'Never edit source code yourself. Never perform QA yourself. Never request production deploy, merge, DNS, secrets, data deletion, or paid services.',
    'This pilot is sandbox-only. Choose exactly one allowed operation: validate-sandbox or compare-with-main.',
    'Set needs_owner_approval=false for these two sandbox operations. Set it true only if your own proposed plan would require production, secrets, DNS, deletion, paid services, or another owner-gated action.',
    'Keep every text field concise and non-repetitive.',
    'Return only the requested structured JSON.'
  ].join('\n');
  const user=JSON.stringify({
    objective:root.objective,
    scope:root.scope,
    acceptance_criteria:root.acceptance_criteria,
    current_status:root.status
  });
  const {parsed,model}=await ollamaChat({system,user,schema:MANAGER_SCHEMA,fetchImpl});
  const decision=validateManagerDecision(parsed);
  root.status='AI_MANAGER_PLANNED';
  root.updated_at=now();
  root.outputs.ai_manager_plan={...decision,model,created_at:now()};

  const devId=taskId+'-AI-DEV-01';
  if(!s.tasks.some(t=>t.task_id===devId)){
    const dev={
      task_id:devId,
      parent_task_id:taskId,
      project:'TrainingBot',
      created_by:'TB-01',
      assigned_to:'DEV-TB-01',
      objective:decision.dev_objective,
      scope:'aion-sandbox',
      acceptance_criteria:['Safe Executor returns PASS and traceable evidence',...decision.qa_focus],
      risk_level:'low',
      status:'QUEUED',
      approval_state:'NOT_REQUIRED',
      inputs:{operation:decision.operation,qa_focus:decision.qa_focus,brain_model:model},
      outputs:{},
      evidence:[],
      created_at:now(),
      updated_at:now()
    };
    s.tasks.push(dev);
    message(s,{task_id:devId,from:'TB-01',to:'DEV-TB-01',type:'AI_TASK_ASSIGNED',payload:{parent_task_id:taskId,objective:dev.objective,operation:decision.operation}});
  }
  audit(s,{actor:'TB-01',action:'AI_MANAGER_PLAN',task_id:taskId,target:'DEV-TB-01',result:'OK',model});
  s.updated_at=now();
  return {state:s,decision};
}

export function prepareAiDevQueue(inputState,{taskId}){
  const s=ensureArrays(clone(inputState));
  const queue=[];
  for(const task of s.tasks.filter(t=>t.parent_task_id===taskId&&t.assigned_to==='DEV-TB-01'&&t.status==='QUEUED')){
    const operation=task.inputs?.operation;
    if(!['validate-sandbox','compare-with-main'].includes(operation)) throw new Error('DEV operation denied: '+operation);
    task.status='EXECUTION_REQUESTED';
    task.updated_at=now();
    queue.push({task_id:task.task_id,operation,parent_task_id:taskId});
    message(s,{task_id:task.task_id,from:'DEV-TB-01',to:'TB-01',type:'EXECUTION_REQUESTED',payload:{operation,branch:'aion-sandbox'}});
    audit(s,{actor:'DEV-TB-01',action:'EXECUTION_REQUESTED',task_id:task.task_id,target:'SAFE_EXECUTOR',result:'QUEUED'});
  }
  s.updated_at=now();
  return {state:s,queue};
}

export async function qaReview(inputState,{taskId,fetchImpl=fetch}){
  const s=ensureArrays(clone(inputState));
  const root=rootTask(s,taskId);
  const dev=s.tasks.filter(t=>t.parent_task_id===taskId&&t.assigned_to==='DEV-TB-01').slice().sort((a,b)=>a.created_at.localeCompare(b.created_at)).at(-1);
  if(!dev) throw new Error('No DEV task for '+taskId);
  const execution=s.executions.filter(e=>e.task_id===dev.task_id).slice().sort((a,b)=>(a.completed_at||'').localeCompare(b.completed_at||'')).at(-1);
  const evidence=dev.outputs?.execution||null;
  const checks=hardQaChecks({dev,execution,evidence});

  const qaId=taskId+'-AI-QA-01';
  let qa=s.tasks.find(t=>t.task_id===qaId);
  if(!qa){
    qa={
      task_id:qaId,
      parent_task_id:taskId,
      project:'TrainingBot',
      created_by:'TB-01',
      assigned_to:'QA-TB-01',
      objective:'Independently review DEV sandbox execution evidence using AI reasoning plus hard evidence gates',
      scope:'evidence review only; no source modification',
      acceptance_criteria:root.outputs?.ai_manager_plan?.qa_focus||[],
      risk_level:'low',
      status:'QUEUED',
      approval_state:'NOT_REQUIRED',
      inputs:{source_dev_task_id:dev.task_id},
      outputs:{},
      evidence:[],
      created_at:now(),
      updated_at:now()
    };
    s.tasks.push(qa);
    message(s,{task_id:qaId,from:'TB-01',to:'QA-TB-01',type:'AI_QA_ASSIGNED',payload:{source_dev_task_id:dev.task_id}});
  }

  const system=[
    'You are QA-TB-01, an independent QA Agent for TrainingBot.',
    'You must not modify source code and must not change acceptance criteria.',
    'Assess only the supplied evidence. Do not invent missing facts.',
    'If evidence is missing, inconsistent, not sandbox-only, or does not support success, return FAIL.',
    'Return only the requested structured JSON.'
  ].join('\n');
  const user=JSON.stringify({
    task:{task_id:qa.task_id,objective:qa.objective,acceptance_criteria:qa.acceptance_criteria},
    dev_task:{task_id:dev.task_id,status:dev.status,objective:dev.objective},
    execution,
    evidence,
    hard_checks:checks
  });
  const {parsed,model}=await ollamaChat({system,user,schema:QA_SCHEMA,fetchImpl});
  const guard=enforceQaVerdict(parsed.verdict,checks);
  const verdict=guard.verdict;
  const report={
    evidence_id:uid('EVD'),
    agent_id:'QA-TB-01',
    at:now(),
    type:'AI_QA_REPORT',
    result:verdict,
    model_verdict:parsed.verdict,
    model_reason:parsed.reason,
    concerns:parsed.concerns,
    hard_checks:checks,
    hard_gate_overrode_model:guard.overridden,
    model
  };
  qa.status=verdict==='PASS'?'QA_PASS':'QA_FAIL';
  qa.updated_at=now();
  qa.outputs.ai_qa_report=report;
  qa.evidence.push(report);
  message(s,{task_id:qa.task_id,from:'QA-TB-01',to:'TB-01',type:'AI_QA_RESULT',payload:{result:verdict,model_reason:parsed.reason,hard_checks:checks}});
  audit(s,{actor:'QA-TB-01',action:'AI_QA_'+verdict,task_id:qa.task_id,target:'TB-01',result:'OK',model});

  root.status=verdict==='PASS'?'READY_FOR_CEO_REVIEW':'NEEDS_REWORK';
  root.updated_at=now();
  root.outputs.ai_manager_summary={
    status:verdict,
    dev_task_id:dev.task_id,
    qa_task_id:qa.task_id,
    manager_plan:root.outputs.ai_manager_plan,
    qa_report:report,
    reported_at:now()
  };
  message(s,{task_id:root.task_id,from:'TB-01',to:'ATLAS',type:'AI_MANAGER_REPORT',payload:{status:verdict,dev_task_id:dev.task_id,qa_task_id:qa.task_id,qa_reason:parsed.reason}});
  audit(s,{actor:'TB-01',action:'AI_MANAGER_REPORT',task_id:root.task_id,target:'ATLAS',result:verdict,model});
  s.updated_at=now();
  return {state:s,report};
}

export function bootstrapAiPilot(inputState,{taskId='AION-AI-PILOT-001'}={}){
  const s=ensureArrays(clone(inputState));
  if(s.tasks.some(t=>t.task_id===taskId)) return s;
  const t={
    task_id:taskId,
    parent_task_id:null,
    project:'TrainingBot',
    created_by:'ATLAS',
    assigned_to:'TB-01',
    objective:'Hãy kiểm tra bằng AI liệu TrainingBot trên nhánh aion-sandbox có thể build an toàn, tự lập kế hoạch kiểm tra và yêu cầu QA độc lập xác minh bằng chứng. Không thay đổi production.',
    scope:'TrainingBot aion-sandbox only',
    acceptance_criteria:[
      'TB-01 AI hiểu yêu cầu tự nhiên và lập kế hoạch sandbox hợp lệ',
      'DEV-TB-01 chỉ gọi Safe Executor',
      'QA-TB-01 AI đánh giá evidence độc lập',
      'Hard permission/evidence gates vẫn có quyền chặn AI',
      'TB-01 báo cáo kết quả về ATLAS'
    ],
    risk_level:'low',
    status:'QUEUED',
    approval_state:'NOT_REQUIRED',
    inputs:{pilot:true,brain_type:'local-llm'},
    outputs:{},
    evidence:[],
    created_at:now(),
    updated_at:now()
  };
  s.tasks.push(t);
  message(s,{task_id:taskId,from:'ATLAS',to:'TB-01',type:'AI_TASK_ASSIGNED',payload:{objective:t.objective}});
  audit(s,{actor:'ATLAS',action:'AI_PILOT_CREATED',task_id:taskId,target:'TB-01',result:'OK'});
  s.updated_at=now();
  return s;
}

export function summary(state,taskId='AION-AI-PILOT-001'){
  const root=state.tasks.find(t=>t.task_id===taskId);
  if(!root) return {task_id:taskId,status:'NOT_FOUND'};
  return {
    task_id:taskId,
    status:root.status,
    manager_plan:root.outputs?.ai_manager_plan||null,
    manager_summary:root.outputs?.ai_manager_summary||null,
    children:state.tasks.filter(t=>t.parent_task_id===taskId).map(t=>({task_id:t.task_id,assigned_to:t.assigned_to,status:t.status,brain_model:t.inputs?.brain_model||t.outputs?.ai_qa_report?.model||null})),
    atlas_messages:state.messages.filter(m=>m.task_id===taskId&&m.to==='ATLAS').map(m=>({type:m.type,payload:m.payload,created_at:m.created_at}))
  };
}

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const cmd=process.argv[2];
  const statePath=arg('--state');
  const taskId=arg('--task-id')||'AION-AI-PILOT-001';
  const output=arg('--output');
  if(!statePath) throw new Error('Missing --state');
  const current=JSON.parse(fs.readFileSync(statePath,'utf8'));
  let next=current;
  if(cmd==='bootstrap') next=bootstrapAiPilot(current,{taskId});
  else if(cmd==='manager-plan') next=(await managerPlan(current,{taskId})).state;
  else if(cmd==='dev-queue'){
    const out=prepareAiDevQueue(current,{taskId});
    next=out.state;
    if(!output) throw new Error('dev-queue requires --output');
    fs.writeFileSync(output,JSON.stringify(out.queue,null,2)+'\n');
  } else if(cmd==='qa-review') next=(await qaReview(current,{taskId})).state;
  else if(cmd==='summary'){
    const out=summary(current,taskId);
    if(output) fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
    else console.log(JSON.stringify(out,null,2));
    process.exit(0);
  } else throw new Error('Unknown command: '+cmd);
  fs.writeFileSync(statePath,JSON.stringify(next,null,2)+'\n');
  console.log(JSON.stringify({ok:true,command:cmd,task_id:taskId,updated_at:next.updated_at}));
}
