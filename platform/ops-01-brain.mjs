import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_MODEL=process.env.AION_LOCAL_MODEL||'qwen2.5:1.5b-instruct';
const DEFAULT_URL=process.env.OLLAMA_URL||'http://127.0.0.1:11434';

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
function arr(v,{min=0,max=16,name='array'}={}){
  if(!Array.isArray(v)) throw new Error(name+' must be an array');
  const out=v.map(x=>String(x||'').trim()).filter(Boolean).slice(0,max);
  if(out.length<min) throw new Error(name+' requires at least '+min+' item(s)');
  return out;
}
function txt(v,name,max=420){
  const out=String(v??'').trim();
  if(!out) throw new Error(name+' is required');
  return out.slice(0,max);
}
function validHttp(code){
  const n=Number(code);
  return Number.isFinite(n)&&n>=200&&n<400;
}

export const OPS01_SCHEMA={
  type:'object',
  properties:{
    status:{type:'string',enum:['HEALTHY','DEGRADED','INCIDENT','PREPARED_FOR_APPROVAL','NEEDS_EVIDENCE','READY_FOR_CEO_REVIEW']},
    severity:{type:'string',enum:['info','warning','critical']},
    summary:{type:'string',maxLength:420},
    task_class:{type:'string',enum:['HEALTH_CHECK','DEPLOYMENT','INCIDENT','BACKUP','RESTORE','ROLLBACK','DNS_OR_DOMAIN','CONFIGURATION','MONITORING','RELEASE_COORDINATION']},
    findings:{type:'array',items:{type:'string',maxLength:260},maxItems:16},
    proposed_actions:{type:'array',items:{type:'string',maxLength:260},maxItems:16},
    verification_steps:{type:'array',items:{type:'string',maxLength:260},maxItems:12},
    rollback_plan:{type:'string',maxLength:420},
    recommended_next_role:{type:'string',enum:['NONE','CODE-01','QA-01','SEC-01','PERF-01','CEO']},
    owner_decision_required:{type:'boolean'},
    owner_decision_reason:{type:'string',maxLength:320}
  },
  required:[
    'status','severity','summary','task_class','findings','proposed_actions',
    'verification_steps','rollback_plan','recommended_next_role',
    'owner_decision_required','owner_decision_reason'
  ]
};

export function hardOps01Checks(evidence={}){
  const routes=Array.isArray(evidence.health?.routes)?evidence.health.routes:[];
  const homepage=routes.find(r=>r.path==='/'||r.name==='homepage')||routes[0]||null;
  const routeResults=routes.map(r=>({
    path:String(r?.path||r?.name||'').slice(0,180),
    http_code:Number(r?.http_code)||0,
    ok:validHttp(r?.http_code)
  }));
  const allRoutesOk=routeResults.length>0&&routeResults.every(r=>r.ok);
  const homepageOk=Boolean(homepage&&validHttp(homepage.http_code));

  const runs=Array.isArray(evidence.recent_workflow_runs)?evidence.recent_workflow_runs:[];
  const completed=runs.filter(r=>r?.status==='completed').slice(0,8);
  const failedRecent=completed.filter(r=>['failure','timed_out','cancelled','action_required'].includes(r?.conclusion)).length;

  const deployment=evidence.deployment||{};
  const expectedSha=String(deployment.expected_sha||'').trim();
  const actualSha=String(deployment.actual_sha||'').trim();
  const deploymentSucceeded=deployment.completed===true&&String(deployment.status||'').toLowerCase()==='success';
  const versionMatches=Boolean(deploymentSucceeded&&actualSha&&(!expectedSha||actualSha===expectedSha));
  const postDeployVerified=deploymentSucceeded&&versionMatches&&deployment.post_deploy_verified===true&&allRoutesOk;

  const approvals=evidence.approvals||{};
  const requestedAction=String(evidence.requested_action||'').toUpperCase();
  const isProduction=requestedAction==='PRODUCTION_DEPLOY'||requestedAction==='PRODUCTION_MUTATION';
  const targetKnown=Boolean(String(evidence.target||'').trim());
  const versionKnown=Boolean(String(evidence.version||expectedSha||'').trim());
  const rollback=evidence.rollback||{};
  const backup=evidence.backup||{};
  const blockers=evidence.blockers||{};

  const productionGate={
    is_production_request:isProduction,
    owner_approved:approvals.owner_production_approval===true,
    target_known:targetKnown,
    version_known:versionKnown,
    rollback_ready:rollback.plan_ready===true&&Boolean(String(rollback.target||'').trim()),
    backup_checked:backup.required===false||(backup.status_checked===true&&backup.available===true),
    no_critical_security_blocker:blockers.critical_security!==true,
    no_critical_qa_blocker:blockers.critical_qa!==true
  };
  productionGate.ready=!isProduction||(
    productionGate.owner_approved&&
    productionGate.target_known&&
    productionGate.version_known&&
    productionGate.rollback_ready&&
    productionGate.backup_checked&&
    productionGate.no_critical_security_blocker&&
    productionGate.no_critical_qa_blocker
  );

  const backupRestoreReady=backup.required===false||(
    backup.available===true&&backup.status_checked===true&&backup.restore_readiness_checked===true
  );

  return {
    routes_present:routeResults.length>0,
    route_results:routeResults,
    homepage_ok:homepageOk,
    all_routes_ok:allRoutesOk,
    recent_completed_runs:completed.length,
    recent_failed_runs:failedRecent,
    deployment_succeeded:deploymentSucceeded,
    deployment_version_matches:versionMatches,
    post_deploy_verified:postDeployVerified,
    backup_restore_ready:backupRestoreReady,
    production_gate:productionGate
  };
}

function modelClaims(input){
  const text=[
    input?.summary,
    ...(Array.isArray(input?.findings)?input.findings:[]),
    ...(Array.isArray(input?.proposed_actions)?input.proposed_actions:[])
  ].join(' ').toLowerCase();
  return {
    deployed:/\b(deployed successfully|deployment succeeded|đã triển khai|triển khai thành công|live successfully|đã live)\b/i.test(text),
    healthy:/\b(system is healthy|service is healthy|hệ thống.*ổn định|healthy after deploy)\b/i.test(text),
    backupUsable:/\b(backup is usable|backup is restorable|backup.*khôi phục được|bản sao lưu.*khôi phục)\b/i.test(text)
  };
}

export function enforceOps01Verdict(model,checks){
  const claims=modelClaims(model);

  if(checks.production_gate.is_production_request&&!checks.production_gate.ready){
    return {
      status:'PREPARED_FOR_APPROVAL',
      severity:'warning',
      recommended_next_role:'CEO',
      owner_decision_required:true,
      overridden:model?.status!=='PREPARED_FOR_APPROVAL',
      reason:'Production safety gate is incomplete; execution must stop before production.'
    };
  }

  if(claims.deployed&&!checks.post_deploy_verified){
    return {
      status:'NEEDS_EVIDENCE',
      severity:'warning',
      recommended_next_role:'NONE',
      owner_decision_required:false,
      overridden:true,
      reason:'Deployment success/live claim lacks verified deployment, version, and post-deploy health evidence.'
    };
  }

  if(claims.backupUsable&&!checks.backup_restore_ready){
    return {
      status:'NEEDS_EVIDENCE',
      severity:'warning',
      recommended_next_role:'NONE',
      owner_decision_required:false,
      overridden:true,
      reason:'Backup usability claim lacks restore-readiness evidence.'
    };
  }

  if(checks.routes_present&&!checks.homepage_ok){
    return {
      status:'INCIDENT',
      severity:'critical',
      recommended_next_role:model?.recommended_next_role==='SEC-01'?'SEC-01':'CODE-01',
      owner_decision_required:Boolean(model?.owner_decision_required),
      overridden:model?.status!=='INCIDENT',
      reason:'Primary monitored route is unavailable.'
    };
  }

  if(checks.routes_present&&!checks.all_routes_ok){
    return {
      status:'DEGRADED',
      severity:'warning',
      recommended_next_role:model?.recommended_next_role==='SEC-01'?'SEC-01':'CODE-01',
      owner_decision_required:Boolean(model?.owner_decision_required),
      overridden:model?.status==='HEALTHY'||model?.status==='READY_FOR_CEO_REVIEW',
      reason:'One or more monitored routes are failing.'
    };
  }

  if(checks.recent_failed_runs>=2&&(model?.status==='HEALTHY'||model?.status==='READY_FOR_CEO_REVIEW')){
    return {
      status:'DEGRADED',
      severity:'warning',
      recommended_next_role:'CEO',
      owner_decision_required:false,
      overridden:true,
      reason:'Multiple recent workflow failures require operational attention.'
    };
  }

  if(claims.healthy&&!checks.routes_present){
    return {
      status:'NEEDS_EVIDENCE',
      severity:'warning',
      recommended_next_role:'NONE',
      owner_decision_required:false,
      overridden:true,
      reason:'Healthy-service claim has no route/health evidence.'
    };
  }

  return {
    status:model?.status||'READY_FOR_CEO_REVIEW',
    severity:model?.severity||'info',
    recommended_next_role:model?.recommended_next_role||'NONE',
    owner_decision_required:Boolean(model?.owner_decision_required),
    overridden:false,
    reason:'Model verdict accepted within operational hard gates.'
  };
}

function validateModelOutput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Invalid OPS-01 output');
  return {
    status:['HEALTHY','DEGRADED','INCIDENT','PREPARED_FOR_APPROVAL','NEEDS_EVIDENCE','READY_FOR_CEO_REVIEW'].includes(input.status)?input.status:'READY_FOR_CEO_REVIEW',
    severity:['info','warning','critical'].includes(input.severity)?input.severity:'warning',
    summary:txt(input.summary,'summary'),
    task_class:['HEALTH_CHECK','DEPLOYMENT','INCIDENT','BACKUP','RESTORE','ROLLBACK','DNS_OR_DOMAIN','CONFIGURATION','MONITORING','RELEASE_COORDINATION'].includes(input.task_class)?input.task_class:'MONITORING',
    findings:arr(input.findings,{max:16,name:'findings'}),
    proposed_actions:arr(input.proposed_actions,{max:16,name:'proposed_actions'}),
    verification_steps:arr(input.verification_steps,{max:12,name:'verification_steps'}),
    rollback_plan:txt(input.rollback_plan,'rollback_plan'),
    recommended_next_role:['NONE','CODE-01','QA-01','SEC-01','PERF-01','CEO'].includes(input.recommended_next_role)?input.recommended_next_role:'NONE',
    owner_decision_required:Boolean(input.owner_decision_required),
    owner_decision_reason:String(input.owner_decision_reason||'').trim().slice(0,320)
  };
}

async function ask({task,evidence,checks,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}){
  const endpoint=new URL(url);
  if(!['http:','https:'].includes(endpoint.protocol)||!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password){
    throw new Error('OPS-01 requires a local Ollama endpoint');
  }

  const system=[
    'You are OPS-01, the independent operations engineer in AION HQ.',
    'You report directly to CEO ATLAS.',
    'Assess only supplied evidence. Never invent deployment, health, workflow, logs, backup, rollback, DNS, version, incident, or production verification.',
    'Production deploy/mutation requires explicit Owner approval plus exact target/version, rollback readiness, relevant backup readiness, and no unresolved critical QA/security blocker.',
    'Do not claim deployment success without version-match and post-deploy health evidence.',
    'Do not claim a backup is usable without restore-readiness evidence.',
    'Do not edit application source, deploy, merge production, change DNS, change secrets, delete data, spend money, or reveal secrets.',
    'Route application defects to CODE-01, acceptance uncertainty to QA-01, security signals to SEC-01, performance regressions to PERF-01, and permission/cross-team decisions to CEO.',
    'Return only JSON matching the schema.'
  ].join('\n');

  let lastError=null;
  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),60000);
    try{
      const res=await fetchImpl(endpoint.toString().replace(/\/$/,'')+'/api/chat',{
        method:'POST',
        headers:{'content-type':'application/json'},
        signal:controller.signal,
        body:JSON.stringify({
          model,stream:false,format:OPS01_SCHEMA,
          options:{temperature:0,num_predict:1400},
          messages:[
            {role:'system',content:system},
            {role:'user',content:JSON.stringify({task,operational_evidence:evidence,hard_checks:checks})}
          ]
        })
      });
      if(!res.ok) throw new Error('Ollama '+res.status+': '+await res.text());
      const out=await res.json();
      const content=out?.message?.content;
      if(!content) throw new Error('Ollama returned empty content');
      return {parsed:JSON.parse(content),model:out.model||model,attempt};
    }catch(error){
      lastError=error;
    }finally{
      clearTimeout(timer);
    }
  }
  throw new Error('OPS-01 model failed after at most two attempts: '+(lastError?.message||String(lastError)));
}

export async function runOps01Brain(inputState,{taskId,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}={}){
  const s=ensureArrays(clone(inputState));
  const task=s.tasks.find(t=>t.task_id===taskId);
  if(!task) throw new Error('Task not found: '+taskId);
  if(task.assigned_to!=='OPS-01') throw new Error('OPS-01 cannot process task assigned to '+task.assigned_to);
  if(task.created_by!=='ATLAS') throw new Error('OPS-01 tasks must be assigned by ATLAS');

  const evidence=task.inputs?.operational_evidence||{};
  const checks=hardOps01Checks(evidence);
  const ai=await ask({
    task:{
      task_id:task.task_id,
      project:task.project,
      objective:task.objective,
      scope:task.scope,
      acceptance_criteria:task.acceptance_criteria,
      constraints:task.inputs?.constraints||[]
    },
    evidence,checks,fetchImpl,url,model
  });
  const modelReport=validateModelOutput(ai.parsed);
  const gate=enforceOps01Verdict(modelReport,checks);

  const report={
    evidence_id:uid('EVD'),
    agent_id:'OPS-01',
    task_id:task.task_id,
    at:now(),
    type:'OPERATIONS_HANDOFF',
    status:gate.status,
    severity:gate.severity,
    summary:modelReport.summary,
    task_class:modelReport.task_class,
    findings:modelReport.findings,
    proposed_actions:modelReport.proposed_actions,
    verification_steps:modelReport.verification_steps,
    rollback_plan:modelReport.rollback_plan,
    recommended_next_role:gate.recommended_next_role,
    owner_decision_required:gate.owner_decision_required,
    owner_decision_reason:modelReport.owner_decision_reason,
    hard_checks:checks,
    hard_gate_overrode_model:gate.overridden,
    hard_gate_reason:gate.reason,
    model:ai.model,
    model_attempt:ai.attempt,
    claims_operational_action_performed:false
  };

  task.outputs=task.outputs||{};
  task.outputs.operations_handoff=report;
  task.evidence=Array.isArray(task.evidence)?task.evidence:[];
  task.evidence.push(report);

  if(report.owner_decision_required) task.status='WAITING_OWNER_APPROVAL';
  else if(['INCIDENT','DEGRADED','NEEDS_EVIDENCE'].includes(report.status)) task.status=report.status;
  else task.status='READY_FOR_CEO_REVIEW';
  task.updated_at=now();

  const type=report.owner_decision_required
    ?'OPS_OWNER_APPROVAL_REQUIRED'
    :(report.status==='INCIDENT'?'OPS_INCIDENT_ALERT'
      :(report.status==='DEGRADED'?'OPS_DEGRADED_ALERT'
        :(report.status==='NEEDS_EVIDENCE'?'OPS_EVIDENCE_REQUIRED':'OPS_HANDOFF_READY')));
  message(s,{
    task_id:task.task_id,
    from:'OPS-01',
    to:'ATLAS',
    type,
    payload:{
      status:task.status,
      ops_status:report.status,
      severity:report.severity,
      recommended_next_role:report.recommended_next_role,
      production_gate_ready:checks.production_gate.ready,
      owner_decision_required:report.owner_decision_required
    }
  });
  audit(s,{
    actor:'OPS-01',
    action:type,
    task_id:task.task_id,
    target:'ATLAS',
    result:task.status,
    model:ai.model
  });
  s.updated_at=now();
  return {state:s,report};
}

export function ops01Summary(state,taskId){
  const task=(state.tasks||[]).find(t=>t.task_id===taskId);
  if(!task) return {task_id:taskId,status:'NOT_FOUND'};
  return {
    task_id:taskId,
    assigned_to:task.assigned_to,
    status:task.status,
    operations_handoff:task.outputs?.operations_handoff||null,
    atlas_messages:(state.messages||[]).filter(m=>m.task_id===taskId&&m.to==='ATLAS')
      .map(m=>({type:m.type,payload:m.payload,created_at:m.created_at}))
  };
}

function arg(name){ const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]:null; }

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const cmd=process.argv[2];
  const statePath=arg('--state');
  const taskId=arg('--task-id');
  const output=arg('--output');
  if(!statePath||!taskId) throw new Error('Usage: node ops-01-brain.mjs <run|summary> --state <file> --task-id <id> [--output <file>]');
  const current=JSON.parse(fs.readFileSync(statePath,'utf8'));
  if(cmd==='run'){
    const out=await runOps01Brain(current,{taskId});
    fs.writeFileSync(statePath,JSON.stringify(out.state,null,2)+'\n');
    if(output) fs.writeFileSync(output,JSON.stringify(out.report,null,2)+'\n');
    else console.log(JSON.stringify(out.report,null,2));
  }else if(cmd==='summary'){
    const out=ops01Summary(current,taskId);
    if(output) fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
    else console.log(JSON.stringify(out,null,2));
  }else throw new Error('Unknown command: '+cmd);
}
