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
function n(v){ const x=Number(v); return Number.isFinite(x)?x:0; }
function arr(v,max=12){ return Array.isArray(v)?v.map(x=>String(x||'').trim()).filter(Boolean).slice(0,max):[]; }

export const SEC_SCHEMA={
  type:'object',
  properties:{
    status:{type:'string',enum:['SECURITY_OK','NEEDS_ATTENTION','CRITICAL']},
    severity:{type:'string',enum:['info','warning','critical']},
    summary:{type:'string',maxLength:360},
    evidence_reviewed:{type:'array',items:{type:'string',maxLength:180},maxItems:12},
    findings:{type:'array',items:{type:'string',maxLength:260},maxItems:12},
    remediation_plan:{type:'array',items:{type:'string',maxLength:260},maxItems:12},
    verification_criteria:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    evidence_gaps:{type:'array',items:{type:'string',maxLength:220},maxItems:10},
    recommended_next_role:{type:'string',enum:['NONE','CODE-01','OPS-01','CEO']},
    owner_approval_required:{type:'boolean'},
    owner_approval_reason:{type:'string',maxLength:320}
  },
  required:['status','severity','summary','evidence_reviewed','findings','remediation_plan','verification_criteria','evidence_gaps','recommended_next_role','owner_approval_required','owner_approval_reason']
};

export function hardSecChecks(evidence={}){
  const scan=evidence.static_scan||{};
  const deps=evidence.dependency_audit||{};
  const headers=evidence.headers||{};
  const auth=evidence.auth||{};
  const secrets=evidence.secrets||{};
  const data=evidence.data_exposure||{};
  const important=['strict_transport_security','content_security_policy','x_content_type_options'];
  const missing=important.filter(k=>headers.available===false?false:headers[k]===false);
  const c={
    evidence_present:Boolean(evidence&&typeof evidence==='object'&&Object.keys(evidence).length),
    private_key_files:n(scan.private_key_files),
    committed_env_files:n(scan.committed_env_files),
    credential_like_files:n(scan.credential_like_files),
    dependency_audit_available:deps.available===true,
    critical_dependencies:n(deps.critical),
    high_dependencies:n(deps.high),
    missing_important_headers:missing,
    confirmed_auth_bypass:auth.confirmed_bypass===true,
    confirmed_authorization_bypass:auth.confirmed_authorization_bypass===true,
    public_secret_exposure:secrets.public_exposure===true,
    sensitive_data_public:data.sensitive_public===true
  };
  c.hard_critical=c.private_key_files>0||c.critical_dependencies>0||c.confirmed_auth_bypass||c.confirmed_authorization_bypass||c.public_secret_exposure||c.sensitive_data_public;
  c.hard_attention=!c.dependency_audit_available||c.committed_env_files>0||c.credential_like_files>0||c.high_dependencies>0||c.missing_important_headers.length>=2;
  return c;
}

function hardFindings(c){
  const out=[];
  if(c.private_key_files>0) out.push('Tracked private-key file indicator reported: '+c.private_key_files);
  if(c.committed_env_files>0) out.push('Tracked environment-file indicator reported: '+c.committed_env_files);
  if(c.credential_like_files>0) out.push('Credential-like tracked filename indicator reported: '+c.credential_like_files);
  if(!c.dependency_audit_available) out.push('Dependency audit evidence is unavailable.');
  if(c.critical_dependencies>0) out.push('Critical dependency findings reported: '+c.critical_dependencies);
  if(c.high_dependencies>0) out.push('High dependency findings reported: '+c.high_dependencies);
  if(c.confirmed_auth_bypass) out.push('Evidence marks an authentication bypass as confirmed.');
  if(c.confirmed_authorization_bypass) out.push('Evidence marks an authorization bypass as confirmed.');
  if(c.public_secret_exposure) out.push('Evidence marks secret material as publicly exposed.');
  if(c.sensitive_data_public) out.push('Evidence marks sensitive data as publicly exposed.');
  if(c.missing_important_headers.length) out.push('Missing important public security headers: '+c.missing_important_headers.join(', '));
  return out;
}

export function enforceSecVerdict(model,checks){
  if(checks.hard_critical){
    return {
      status:'CRITICAL',
      severity:'critical',
      recommended_next_role:'CEO',
      owner_approval_required:Boolean(checks.public_secret_exposure||checks.private_key_files>0||checks.confirmed_auth_bypass||checks.confirmed_authorization_bypass||checks.sensitive_data_public),
      overridden:model?.status!=='CRITICAL',
      reason:'Hard security evidence requires critical escalation'
    };
  }
  if(checks.hard_attention&&model?.status==='SECURITY_OK'){
    return {
      status:'NEEDS_ATTENTION',
      severity:'warning',
      recommended_next_role:model?.recommended_next_role==='OPS-01'?'OPS-01':'CODE-01',
      owner_approval_required:Boolean(model?.owner_approval_required),
      overridden:true,
      reason:'Hard security evidence requires attention'
    };
  }
  return {
    status:model?.status||'NEEDS_ATTENTION',
    severity:model?.severity||'warning',
    recommended_next_role:model?.recommended_next_role||'CEO',
    owner_approval_required:Boolean(model?.owner_approval_required),
    overridden:false,
    reason:'AI verdict accepted within hard security gates'
  };
}

async function ask({task,evidence,checks,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}){
  const system=[
    'You are SEC-01, the independent defensive security engineer in AION HQ.',
    'You report directly to CEO ATLAS.',
    'Assess only supplied evidence. Never invent scans, exploits, vulnerabilities, access, or test results.',
    'Never reveal or request secret values. Refer only to exposure indicators.',
    'Distinguish confirmed findings from hardening opportunities and evidence gaps.',
    'Do not edit code, change permissions, rotate credentials, deploy, delete data, or spend money.',
    'Return only structured JSON matching the schema.'
  ].join('\n');
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
          model,stream:false,format:SEC_SCHEMA,
          options:{temperature:0,num_predict:1200},
          messages:[
            {role:'system',content:system},
            {role:'user',content:JSON.stringify({task,evidence,hard_checks:checks})}
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
  throw lastError||new Error('SEC-01 model failed');
}

export async function runSecBrain(inputState,{taskId,fetchImpl=fetch}){
  const s=ensureArrays(clone(inputState));
  const task=s.tasks.find(t=>t.task_id===taskId);
  if(!task) throw new Error('Task not found: '+taskId);
  if(task.assigned_to!=='SEC-01') throw new Error('SEC-01 cannot process task assigned to '+task.assigned_to);

  const evidence=task.inputs?.security_evidence||task.inputs?.evidence||{};
  const checks=hardSecChecks(evidence);
  const ai=await ask({
    task:{task_id:task.task_id,project:task.project,objective:task.objective,scope:task.scope,acceptance_criteria:task.acceptance_criteria},
    evidence,checks,fetchImpl
  });
  const gate=enforceSecVerdict(ai.parsed,checks);
  const report={
    evidence_id:uid('EVD'),
    agent_id:'SEC-01',
    at:now(),
    type:'SECURITY_HANDOFF',
    status:gate.status,
    severity:gate.severity,
    summary:String(ai.parsed.summary||'').slice(0,360),
    evidence_reviewed:arr(ai.parsed.evidence_reviewed),
    findings:gate.overridden?[...new Set([...hardFindings(checks),...arr(ai.parsed.findings)])].slice(0,12):arr(ai.parsed.findings),
    remediation_plan:arr(ai.parsed.remediation_plan),
    verification_criteria:arr(ai.parsed.verification_criteria),
    evidence_gaps:arr(ai.parsed.evidence_gaps,10),
    recommended_next_role:gate.recommended_next_role,
    owner_approval_required:gate.owner_approval_required,
    owner_approval_reason:String(ai.parsed.owner_approval_reason||'').slice(0,320),
    hard_checks:checks,
    hard_gate_overrode_model:gate.overridden,
    hard_gate_reason:gate.reason,
    model:ai.model,
    model_attempt:ai.attempt
  };

  task.outputs=task.outputs||{};
  task.outputs.security_handoff=report;
  task.evidence=Array.isArray(task.evidence)?task.evidence:[];
  task.evidence.push(report);
  task.status=report.status==='CRITICAL'?'SECURITY_CRITICAL':'READY_FOR_CEO_REVIEW';
  task.updated_at=now();

  message(s,{
    task_id:task.task_id,
    from:'SEC-01',
    to:'ATLAS',
    type:report.status==='CRITICAL'?'SECURITY_CRITICAL_ALERT':'SECURITY_HANDOFF_READY',
    payload:{status:report.status,severity:report.severity,recommended_next_role:report.recommended_next_role,owner_approval_required:report.owner_approval_required}
  });
  audit(s,{
    actor:'SEC-01',
    action:report.status==='CRITICAL'?'SECURITY_CRITICAL_ESCALATION':'SECURITY_HANDOFF_SUBMITTED',
    task_id:task.task_id,
    target:'ATLAS',
    result:report.status,
    model:ai.model
  });
  s.updated_at=now();
  return {state:s,report};
}

export function secSummary(state,taskId){
  const task=(state.tasks||[]).find(t=>t.task_id===taskId);
  if(!task) return {task_id:taskId,status:'NOT_FOUND'};
  return {
    task_id:taskId,
    assigned_to:task.assigned_to,
    status:task.status,
    security_handoff:task.outputs?.security_handoff||null,
    atlas_messages:(state.messages||[]).filter(m=>m.task_id===taskId&&m.to==='ATLAS').map(m=>({type:m.type,payload:m.payload,created_at:m.created_at}))
  };
}

function arg(name){ const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]:null; }

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const cmd=process.argv[2];
  const statePath=arg('--state');
  const taskId=arg('--task-id');
  const output=arg('--output');
  if(!statePath||!taskId) throw new Error('Missing --state or --task-id');
  const current=JSON.parse(fs.readFileSync(statePath,'utf8'));
  if(cmd==='run'){
    const out=await runSecBrain(current,{taskId});
    fs.writeFileSync(statePath,JSON.stringify(out.state,null,2)+'\n');
    if(output) fs.writeFileSync(output,JSON.stringify(out.report,null,2)+'\n');
    else console.log(JSON.stringify(out.report,null,2));
  }else if(cmd==='summary'){
    const out=secSummary(current,taskId);
    if(output) fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
    else console.log(JSON.stringify(out,null,2));
  }else throw new Error('Unknown command: '+cmd);
}
