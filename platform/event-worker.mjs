import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

function now(){ return new Date().toISOString(); }
function uid(prefix){ return prefix+'-'+crypto.randomUUID(); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }

export function createEmptyState(){
  return {
    version:1,
    updated_at:now(),
    agents:[
      {agent_id:'OWNER',role:'owner',reports_to:null},
      {agent_id:'ATLAS',role:'ceo',reports_to:'OWNER'},
      {agent_id:'TB-01',role:'manager',reports_to:'ATLAS'},
      {agent_id:'DEV-TB-01',role:'developer',reports_to:'TB-01'},
      {agent_id:'QA-TB-01',role:'qa',reports_to:'TB-01'},
      {agent_id:'SEO-TB-01',role:'seo',reports_to:'TB-01'},
      {agent_id:'CONTENT-TB-01',role:'content',reports_to:'TB-01'},
      {agent_id:'SECURITY-TB-01',role:'security',reports_to:'TB-01'},
      {agent_id:'OPS-TB-01',role:'ops',reports_to:'TB-01'},
      {agent_id:'ANALYTICS-TB-01',role:'analytics',reports_to:'TB-01'}
    ],
    tasks:[],
    messages:[],
    memories:[],
    executions:[],
    audit:[]
  };
}

function agent(state,id){
  const a=state.agents.find(x=>x.agent_id===id);
  if(!a) throw new Error('Unknown agent: '+id);
  return a;
}
function addAudit(state,entry){
  state.audit.push({audit_id:uid('AUD'),at:now(),...entry});
}
function canAssign(state,from,to){
  const target=agent(state,to);
  return target.reports_to===from;
}

export function applyEvent(inputState,type,payload={}){
  const state=clone(inputState||createEmptyState());
  if(!Array.isArray(state.audit)) state.audit=[];
  if(!Array.isArray(state.tasks)) state.tasks=[];
  if(!Array.isArray(state.messages)) state.messages=[];
  if(!Array.isArray(state.memories)) state.memories=[];
  if(!Array.isArray(state.executions)) state.executions=[];

  if(type==='create_task'){
    const actor=payload.actor_id;
    const assigned=payload.assigned_to;
    agent(state,actor); agent(state,assigned);
    if(!canAssign(state,actor,assigned)) throw new Error(actor+' cannot assign directly to '+assigned);
    const requestedId=payload.task_id||null;
    if(requestedId){
      const existing=state.tasks.find(x=>x.task_id===requestedId);
      if(existing){
        addAudit(state,{actor,action:'TASK_DUPLICATE_IGNORED',task_id:requestedId,target:assigned,result:'NOOP'});
        state.updated_at=now();
        return state;
      }
    }
    const task={
      task_id:payload.task_id||uid('TASK'),
      parent_task_id:payload.parent_task_id||null,
      project:payload.project||'TrainingBot',
      created_by:actor,
      assigned_to:assigned,
      objective:payload.objective||'',
      scope:payload.scope||'',
      acceptance_criteria:payload.acceptance_criteria||[],
      risk_level:payload.risk_level||'low',
      status:'QUEUED',
      approval_state:'NOT_REQUIRED',
      inputs:payload.inputs||{},
      outputs:{},
      evidence:[],
      created_at:now(),
      updated_at:now()
    };
    state.tasks.push(task);
    state.messages.push({
      message_id:uid('MSG'),
      task_id:task.task_id,
      from:actor,
      to:assigned,
      type:'TASK_ASSIGNED',
      payload:{objective:task.objective},
      created_at:now(),
      read_at:null
    });
    addAudit(state,{actor,action:'TASK_CREATED',task_id:task.task_id,target:assigned,result:'OK'});
  } else if(type==='message_send'){
    agent(state,payload.from); agent(state,payload.to);
    state.messages.push({
      message_id:uid('MSG'),
      task_id:payload.task_id||null,
      from:payload.from,
      to:payload.to,
      type:payload.message_type||'MESSAGE',
      payload:payload.payload||{},
      created_at:now(),
      read_at:null
    });
    addAudit(state,{actor:payload.from,action:'MESSAGE_SENT',task_id:payload.task_id||null,target:payload.to,result:'OK'});
  } else if(type==='memory_write'){
    agent(state,payload.owner);
    const rec={
      memory_id:uid('MEM'),
      owner:payload.owner,
      key:payload.key,
      value:payload.value,
      visibility:payload.visibility||'private',
      updated_at:now()
    };
    const i=state.memories.findIndex(x=>x.owner===rec.owner&&x.key===rec.key);
    if(i>=0) state.memories[i]=rec; else state.memories.push(rec);
    addAudit(state,{actor:payload.owner,action:'MEMORY_WRITE',target:payload.owner,result:'OK'});
  } else if(type==='executor_result'){
    const taskId=payload.task_id;
    const result=payload.result==='PASS'?'PASS':'FAIL';
    let task=state.tasks.find(x=>x.task_id===taskId);
    if(!task){
      task={
        task_id:taskId,
        parent_task_id:payload.parent_task_id||null,
        project:'TrainingBot',
        created_by:'TB-01',
        assigned_to:'DEV-TB-01',
        objective:payload.objective||'External sandbox execution',
        scope:'aion-sandbox',
        acceptance_criteria:['Safe Executor returns evidence'],
        risk_level:'low',
        status:'QUEUED',
        approval_state:'NOT_REQUIRED',
        inputs:{},
        outputs:{},
        evidence:[],
        created_at:now(),
        updated_at:now()
      };
      state.tasks.push(task);
      addAudit(state,{actor:'SYSTEM',action:'TASK_IMPORTED',task_id:taskId,target:'DEV-TB-01',result:'OK'});
    }
    const evidence={
      evidence_id:uid('EVD'),
      agent_id:'DEV-TB-01',
      at:now(),
      type:'EXECUTOR_RESULT',
      run_id:String(payload.run_id||''),
      run_url:payload.run_url||null,
      head_sha:payload.head_sha||null,
      operation:payload.operation||null,
      conclusion:payload.conclusion||null,
      result
    };
    task.evidence.push(evidence);
    task.outputs.execution=evidence;
    task.status=result==='PASS'?'EXECUTION_PASSED':'EXECUTION_FAILED';
    task.updated_at=now();
    const existing=state.executions.find(x=>String(x.run_id)===String(payload.run_id));
    if(!existing){
      state.executions.push({
        execution_id:uid('EXE'),
        task_id:taskId,
        agent_id:'DEV-TB-01',
        run_id:String(payload.run_id||''),
        run_url:payload.run_url||null,
        operation:payload.operation||null,
        branch:'aion-sandbox',
        status:result==='PASS'?'SUCCESS':'FAILED',
        result,
        created_at:payload.created_at||now(),
        completed_at:payload.updated_at||now()
      });
    }
    state.messages.push({
      message_id:uid('MSG'),
      task_id:taskId,
      from:'EXECUTOR',
      to:'DEV-TB-01',
      type:'EXECUTION_RESULT',
      payload:evidence,
      created_at:now(),
      read_at:null
    });
    addAudit(state,{actor:'EXECUTOR',action:'EXECUTION_RESULT',task_id:taskId,target:'DEV-TB-01',result});
  } else if(type==='qa_result'){
    const task=state.tasks.find(x=>x.task_id===payload.task_id);
    if(!task) throw new Error('Task not found: '+payload.task_id);
    const result=payload.result==='PASS'?'PASS':'FAIL';
    task.status=result==='PASS'?'QA_PASS':'QA_FAIL';
    task.updated_at=now();
    task.evidence.push({
      evidence_id:uid('EVD'),
      agent_id:'QA-TB-01',
      at:now(),
      type:'QA_REPORT',
      result,
      notes:payload.notes||null
    });
    state.messages.push({
      message_id:uid('MSG'),
      task_id:task.task_id,
      from:'QA-TB-01',
      to:'TB-01',
      type:'QA_RESULT',
      payload:{result,notes:payload.notes||null},
      created_at:now(),
      read_at:null
    });
    addAudit(state,{actor:'QA-TB-01',action:'QA_'+result,task_id:task.task_id,target:'TB-01',result:'OK'});
  } else {
    throw new Error('Unsupported event type: '+type);
  }

  state.updated_at=now();
  return state;
}

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const statePath=arg('--state');
  const type=arg('--type');
  const payloadText=arg('--payload')||'{}';
  if(!statePath||!type) throw new Error('Usage: node event-worker.mjs --state <file> --type <event> --payload <json>');
  const current=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):createEmptyState();
  const next=applyEvent(current,type,JSON.parse(payloadText));
  fs.writeFileSync(statePath,JSON.stringify(next,null,2)+'\n');
  console.log(JSON.stringify({ok:true,type,updated_at:next.updated_at,tasks:next.tasks.length,messages:next.messages.length,audit:next.audit.length}));
}
