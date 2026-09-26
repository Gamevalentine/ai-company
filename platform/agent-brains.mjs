import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

function now(){ return new Date().toISOString(); }
function uid(prefix){ return prefix+'-'+crypto.randomUUID(); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }
function ensureArrays(s){
  for(const k of ['tasks','messages','memories','executions','audit']) if(!Array.isArray(s[k])) s[k]=[];
  return s;
}
function audit(s,entry){ s.audit.push({audit_id:uid('AUD'),at:now(),...entry}); }
function message(s,{task_id,from,to,type,payload={}}){
  if(s.messages.some(m=>m.task_id===task_id&&m.from===from&&m.to===to&&m.type===type)) return;
  s.messages.push({message_id:uid('MSG'),task_id,from,to,type,payload,created_at:now(),read_at:null});
}
function childTasks(s,parent){ return s.tasks.filter(t=>t.parent_task_id===parent.task_id); }

export function ensurePilotRoot(inputState,{taskId='AION-AGENT-PILOT-001'}={}){
  const s=ensureArrays(clone(inputState));
  if(s.tasks.some(t=>t.task_id===taskId)) return s;
  const task={
    task_id:taskId,
    parent_task_id:null,
    project:'TrainingBot',
    created_by:'ATLAS',
    assigned_to:'TB-01',
    objective:'Verify autonomous TrainingBot agent chain from Manager to DEV to QA and back to ATLAS',
    scope:'aion-sandbox only',
    acceptance_criteria:[
      'TB-01 creates and tracks a DEV task',
      'DEV task executes only through Safe Executor on aion-sandbox',
      'QA-TB-01 independently evaluates executor evidence',
      'TB-01 reports a PASS/FAIL summary to ATLAS',
      'No production action occurs'
    ],
    risk_level:'low',
    status:'QUEUED',
    approval_state:'NOT_REQUIRED',
    inputs:{pilot:true},
    outputs:{},
    evidence:[],
    created_at:now(),
    updated_at:now()
  };
  s.tasks.push(task);
  message(s,{task_id:taskId,from:'ATLAS',to:'TB-01',type:'TASK_ASSIGNED',payload:{objective:task.objective}});
  audit(s,{actor:'ATLAS',action:'TASK_CREATED',task_id:taskId,target:'TB-01',result:'OK'});
  s.updated_at=now();
  return s;
}

function createDevTask(s,root,attempt=1){
  const id=root.task_id+'-DEV-'+String(attempt).padStart(2,'0');
  if(s.tasks.some(t=>t.task_id===id)) return;
  const task={
    task_id:id,
    parent_task_id:root.task_id,
    project:'TrainingBot',
    created_by:'TB-01',
    assigned_to:'DEV-TB-01',
    objective:'Validate TrainingBot sandbox build for '+root.task_id,
    scope:'aion-sandbox',
    acceptance_criteria:['Safe Executor validate-sandbox returns PASS with run evidence'],
    risk_level:'low',
    status:'QUEUED',
    approval_state:'NOT_REQUIRED',
    inputs:{operation:'validate-sandbox',attempt},
    outputs:{},
    evidence:[],
    created_at:now(),
    updated_at:now()
  };
  s.tasks.push(task);
  message(s,{task_id:id,from:'TB-01',to:'DEV-TB-01',type:'TASK_ASSIGNED',payload:{objective:task.objective,parent_task_id:root.task_id}});
  audit(s,{actor:'TB-01',action:'DEV_TASK_CREATED',task_id:id,target:'DEV-TB-01',result:'OK'});
}

function createQaTask(s,root,dev){
  const existing=childTasks(s,root).find(t=>t.assigned_to==='QA-TB-01'&&t.inputs?.source_dev_task_id===dev.task_id);
  if(existing) return;
  const qaCount=childTasks(s,root).filter(t=>t.assigned_to==='QA-TB-01').length+1;
  const id=root.task_id+'-QA-'+String(qaCount).padStart(2,'0');
  const task={
    task_id:id,
    parent_task_id:root.task_id,
    project:'TrainingBot',
    created_by:'TB-01',
    assigned_to:'QA-TB-01',
    objective:'Independently verify Safe Executor evidence from '+dev.task_id,
    scope:'evidence review only; no source modification',
    acceptance_criteria:[
      'Executor result is PASS',
      'Execution belongs to aion-sandbox',
      'Run URL and commit SHA exist',
      'Operation is an approved sandbox operation'
    ],
    risk_level:'low',
    status:'QUEUED',
    approval_state:'NOT_REQUIRED',
    inputs:{source_dev_task_id:dev.task_id},
    outputs:{},
    evidence:[],
    created_at:now(),
    updated_at:now()
  };
  s.tasks.push(task);
  message(s,{task_id:id,from:'TB-01',to:'QA-TB-01',type:'TASK_ASSIGNED',payload:{source_dev_task_id:dev.task_id,parent_task_id:root.task_id}});
  audit(s,{actor:'TB-01',action:'QA_TASK_CREATED',task_id:id,target:'QA-TB-01',result:'OK'});
}

export function runManagerBrain(inputState){
  const s=ensureArrays(clone(inputState));
  const roots=s.tasks.filter(t=>t.assigned_to==='TB-01'&&!t.parent_task_id);
  for(const root of roots){
    if(root.status==='QUEUED'){
      root.status='MANAGER_ACCEPTED';
      root.updated_at=now();
      audit(s,{actor:'TB-01',action:'TASK_ACCEPTED',task_id:root.task_id,target:'TB-01',result:'OK'});
    }
    if(['READY_FOR_CEO_REVIEW','COMPLETED','WAITING_OWNER_APPROVAL'].includes(root.status)) continue;
    const children=childTasks(s,root);
    const devs=children.filter(t=>t.assigned_to==='DEV-TB-01');
    const qas=children.filter(t=>t.assigned_to==='QA-TB-01');

    if(devs.length===0){
      createDevTask(s,root,1);
      root.status='MANAGER_DELEGATED';
      root.updated_at=now();
      continue;
    }

    const latestDev=devs.slice().sort((a,b)=>a.created_at.localeCompare(b.created_at)).at(-1);
    if(latestDev.status==='EXECUTION_PASSED'){
      createQaTask(s,root,latestDev);
      if(!['QA_PASS','QA_FAIL'].includes(root.status)){
        root.status='WAITING_QA';
        root.updated_at=now();
      }
    }

    const latestQa=qas.concat(childTasks(s,root).filter(t=>t.assigned_to==='QA-TB-01'&&!qas.includes(t)))
      .slice().sort((a,b)=>a.created_at.localeCompare(b.created_at)).at(-1);

    if(latestQa?.status==='QA_FAIL'){
      root.status='NEEDS_REWORK';
      root.updated_at=now();
      const attempt=devs.length+1;
      if(attempt<=3) createDevTask(s,root,attempt);
      message(s,{task_id:root.task_id,from:'TB-01',to:'ATLAS',type:'MANAGER_ALERT',payload:{status:'NEEDS_REWORK',qa_task_id:latestQa.task_id}});
      audit(s,{actor:'TB-01',action:'MANAGER_REWORK',task_id:root.task_id,target:'ATLAS',result:'NEEDS_REWORK'});
    } else if(latestQa?.status==='QA_PASS'){
      root.status='READY_FOR_CEO_REVIEW';
      root.updated_at=now();
      root.outputs.manager_summary={
        status:'PASS',
        dev_task_id:latestDev?.task_id||null,
        qa_task_id:latestQa.task_id,
        reported_at:now()
      };
      message(s,{task_id:root.task_id,from:'TB-01',to:'ATLAS',type:'MANAGER_REPORT',payload:root.outputs.manager_summary});
      audit(s,{actor:'TB-01',action:'MANAGER_REPORT',task_id:root.task_id,target:'ATLAS',result:'PASS'});
    }
  }
  s.updated_at=now();
  return s;
}

export function prepareDevQueue(inputState){
  const s=ensureArrays(clone(inputState));
  const queue=[];
  for(const task of s.tasks.filter(t=>t.assigned_to==='DEV-TB-01'&&t.status==='QUEUED')){
    task.status='EXECUTION_REQUESTED';
    task.updated_at=now();
    const operation=task.inputs?.operation||'validate-sandbox';
    queue.push({task_id:task.task_id,operation,parent_task_id:task.parent_task_id});
    message(s,{task_id:task.task_id,from:'DEV-TB-01',to:'TB-01',type:'EXECUTION_REQUESTED',payload:{operation,branch:'aion-sandbox'}});
    audit(s,{actor:'DEV-TB-01',action:'EXECUTION_REQUESTED',task_id:task.task_id,target:'SAFE_EXECUTOR',result:'QUEUED'});
  }
  s.updated_at=now();
  return {state:s,queue};
}

export function runQaBrain(inputState){
  const s=ensureArrays(clone(inputState));
  for(const qa of s.tasks.filter(t=>t.assigned_to==='QA-TB-01'&&t.status==='QUEUED')){
    const devId=qa.inputs?.source_dev_task_id;
    const dev=s.tasks.find(t=>t.task_id===devId);
    const execution=s.executions.filter(e=>e.task_id===devId).slice().sort((a,b)=>(a.completed_at||'').localeCompare(b.completed_at||'')).at(-1);
    const ev=dev?.outputs?.execution||null;
    const checks={
      dev_task_exists:Boolean(dev),
      dev_execution_passed:dev?.status==='EXECUTION_PASSED',
      execution_success:execution?.status==='SUCCESS'&&execution?.result==='PASS',
      sandbox_branch:execution?.branch==='aion-sandbox',
      allowed_operation:['validate-sandbox','compare-with-main'].includes(ev?.operation||execution?.operation),
      has_run_url:Boolean(ev?.run_url||execution?.run_url),
      has_commit_sha:Boolean(ev?.head_sha)
    };
    const pass=Object.values(checks).every(Boolean);
    qa.status=pass?'QA_PASS':'QA_FAIL';
    qa.updated_at=now();
    const report={
      evidence_id:uid('EVD'),
      agent_id:'QA-TB-01',
      at:now(),
      type:'QA_REPORT',
      result:pass?'PASS':'FAIL',
      source_dev_task_id:devId,
      checks
    };
    qa.evidence.push(report);
    qa.outputs.qa_report=report;
    message(s,{task_id:qa.task_id,from:'QA-TB-01',to:'TB-01',type:'QA_RESULT',payload:{result:report.result,source_dev_task_id:devId,checks}});
    audit(s,{actor:'QA-TB-01',action:'QA_'+report.result,task_id:qa.task_id,target:'TB-01',result:'OK'});
  }
  s.updated_at=now();
  return s;
}

export function getPilotSummary(state,taskId='AION-AGENT-PILOT-001'){
  const root=state.tasks.find(t=>t.task_id===taskId);
  if(!root) return {task_id:taskId,status:'NOT_FOUND'};
  const children=state.tasks.filter(t=>t.parent_task_id===taskId);
  return {
    task_id:taskId,
    status:root.status,
    manager_summary:root.outputs?.manager_summary||null,
    children:children.map(t=>({task_id:t.task_id,assigned_to:t.assigned_to,status:t.status})),
    atlas_messages:state.messages.filter(m=>m.to==='ATLAS'&&m.task_id===taskId).map(m=>({type:m.type,payload:m.payload,created_at:m.created_at}))
  };
}

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const cmd=process.argv[2];
  const statePath=arg('--state');
  const output=arg('--output');
  if(!statePath) throw new Error('Missing --state');
  const current=JSON.parse(fs.readFileSync(statePath,'utf8'));
  let next=current;
  if(cmd==='bootstrap') next=ensurePilotRoot(current,{taskId:arg('--task-id')||'AION-AGENT-PILOT-001'});
  else if(cmd==='manager') next=runManagerBrain(current);
  else if(cmd==='dev-queue'){
    const out=prepareDevQueue(current);
    next=out.state;
    if(!output) throw new Error('dev-queue requires --output');
    fs.writeFileSync(output,JSON.stringify(out.queue,null,2)+'\n');
  } else if(cmd==='qa') next=runQaBrain(current);
  else if(cmd==='summary'){
    const summary=getPilotSummary(current,arg('--task-id')||'AION-AGENT-PILOT-001');
    if(output) fs.writeFileSync(output,JSON.stringify(summary,null,2)+'\n');
    else console.log(JSON.stringify(summary,null,2));
    process.exit(0);
  } else throw new Error('Unknown command: '+cmd);
  fs.writeFileSync(statePath,JSON.stringify(next,null,2)+'\n');
  console.log(JSON.stringify({ok:true,command:cmd,updated_at:next.updated_at}));
}
