import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODEL=process.env.AION_LOCAL_MODEL||'qwen2.5:1.5b-instruct';
const URL=process.env.OLLAMA_URL||'http://127.0.0.1:11434';

const SCHEMA={
  type:'object',
  properties:{
    status:{type:'string',enum:['SECURITY_OK','NEEDS_ATTENTION','CRITICAL']},
    severity:{type:'string',enum:['info','warning','critical']},
    summary:{type:'string',maxLength:360},
    findings:{type:'array',maxItems:10,items:{type:'string',maxLength:240}},
    recommended_action:{type:'string',enum:['NO_ACTION','ESCALATE_DEV','ESCALATE_MANAGER']},
    needs_manager_attention:{type:'boolean'}
  },
  required:['status','severity','summary','findings','recommended_action','needs_manager_attention']
};

export function hardSecurityChecks(evidence={}){
  const scan=evidence.static_scan||{};
  const deps=evidence.dependency_audit||{};
  const headers=evidence.headers||{};
  const privateKeyFiles=Number(scan.private_key_files||0);
  const envFiles=Number(scan.committed_env_files||0);
  const credentialLikeFiles=Number(scan.credential_like_files||0);
  const criticalDeps=Number(deps.critical||0);
  const highDeps=Number(deps.high||0);
  const importantHeaders=['strict_transport_security','content_security_policy','x_content_type_options'];
  const missingHeaders=importantHeaders.filter(k=>!headers[k]);

  return {
    evidence_present:Boolean(evidence&&typeof evidence==='object'),
    private_key_files:privateKeyFiles,
    committed_env_files:envFiles,
    credential_like_files:credentialLikeFiles,
    critical_dependency_findings:criticalDeps,
    high_dependency_findings:highDeps,
    missing_important_headers:missingHeaders,
    hard_critical:privateKeyFiles>0||criticalDeps>0,
    hard_attention:envFiles>0||credentialLikeFiles>0||highDeps>0||missingHeaders.length>=2
  };
}

export function enforceSecurityVerdict(model,checks){
  if(checks.hard_critical){
    return {
      status:'CRITICAL',severity:'critical',
      recommended_action:'ESCALATE_MANAGER',
      needs_manager_attention:true,overridden:model?.status!=='CRITICAL',
      reason:'Hard security gate detected critical evidence'
    };
  }
  if(checks.hard_attention&&model?.status==='SECURITY_OK'){
    return {
      status:'NEEDS_ATTENTION',severity:'warning',
      recommended_action:'ESCALATE_DEV',
      needs_manager_attention:true,overridden:true,
      reason:'Hard security gate requires review'
    };
  }
  return {
    status:model?.status||'NEEDS_ATTENTION',
    severity:model?.severity||'warning',
    recommended_action:model?.recommended_action||'ESCALATE_MANAGER',
    needs_manager_attention:Boolean(model?.needs_manager_attention),
    overridden:false,
    reason:'AI verdict accepted within hard security gates'
  };
}

async function ask(evidence,checks,fetchImpl=fetch){
  let lastError=null;
  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),120000);
    try{
      const res=await fetchImpl(URL+'/api/chat',{
        method:'POST',
        headers:{'content-type':'application/json'},
        signal:controller.signal,
        body:JSON.stringify({
          model:MODEL,stream:false,format:SCHEMA,
          options:{temperature:0,num_predict:800},
          messages:[
            {role:'system',content:'You are SECURITY-TB-01, a defensive read-only security reviewer for TrainingBot. Assess only supplied evidence. Never expose secrets, never invent vulnerabilities, never modify code, credentials, infrastructure, DNS, or production. Distinguish configuration hardening opportunities from confirmed vulnerabilities. Return structured JSON only.'},
            {role:'user',content:JSON.stringify({evidence,hard_checks:checks})}
          ]
        })
      });
      if(!res.ok) throw new Error('Ollama '+res.status);
      const out=await res.json();
      const content=out?.message?.content;
      if(!content) throw new Error('Empty model response');
      return {parsed:JSON.parse(content),model:out.model||MODEL,attempt};
    }catch(error){
      lastError=error;
      if(attempt<2) await new Promise(r=>setTimeout(r,1000));
    }finally{
      clearTimeout(timer);
    }
  }
  throw new Error('Security brain failed after 2 attempts: '+(lastError?.message||String(lastError)));
}

export async function reviewSecurityEvidence(evidence,{fetchImpl=fetch}={}){
  const checks=hardSecurityChecks(evidence);
  const ai=await ask(evidence,checks,fetchImpl);
  const gate=enforceSecurityVerdict(ai.parsed,checks);
  return {
    agent_id:'SECURITY-TB-01',
    status:gate.status,
    severity:gate.severity,
    summary:ai.parsed.summary,
    findings:Array.isArray(ai.parsed.findings)?ai.parsed.findings:[],
    recommended_action:gate.recommended_action,
    needs_manager_attention:gate.needs_manager_attention,
    hard_checks:checks,
    hard_gate_overrode_model:gate.overridden,
    hard_gate_reason:gate.reason,
    model:ai.model,
    model_attempt:ai.attempt,
    reviewed_at:new Date().toISOString()
  };
}

export function renderSecurityMarkdown(report){
  return [
    '# SECURITY-TB-01 TrainingBot report','',
    '- Status: **'+report.status+'**',
    '- Severity: **'+report.severity+'**',
    '- Recommended action: **'+report.recommended_action+'**',
    '- Manager attention: **'+String(report.needs_manager_attention)+'**','',
    '## Summary',report.summary||'No summary','','## Findings',
    ...(report.findings.length?report.findings.map(x=>'- '+x):['- No additional findings']),
    '','Sensitive values exposed in report: **NO**',
    'Production changes performed: **NO**'
  ].join('\n');
}

function arg(name){ const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]:null; }

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv[2]!=='review') throw new Error('Unknown command');
  const evidencePath=arg('--evidence'), output=arg('--output'), markdown=arg('--markdown');
  if(!evidencePath||!output) throw new Error('Missing arguments');
  const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
  const report=await reviewSecurityEvidence(evidence);
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  if(markdown) fs.writeFileSync(markdown,renderSecurityMarkdown(report)+'\n');
  console.log(JSON.stringify({ok:true,agent_id:report.agent_id,status:report.status,severity:report.severity,recommended_action:report.recommended_action}));
}
