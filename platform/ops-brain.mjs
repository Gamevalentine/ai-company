import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_MODEL=process.env.AION_LOCAL_MODEL||'qwen2.5:1.5b-instruct';
const DEFAULT_URL=process.env.OLLAMA_URL||'http://127.0.0.1:11434';

const OPS_SCHEMA={
  type:'object',
  properties:{
    status:{type:'string',enum:['HEALTHY','DEGRADED','INCIDENT']},
    severity:{type:'string',enum:['info','warning','critical']},
    summary:{type:'string',maxLength:320},
    findings:{type:'array',maxItems:8,items:{type:'string',maxLength:220}},
    recommended_action:{type:'string',enum:['NO_ACTION','ESCALATE_DEV','ESCALATE_SECURITY','ESCALATE_MANAGER']},
    needs_manager_attention:{type:'boolean'}
  },
  required:['status','severity','summary','findings','recommended_action','needs_manager_attention']
};

function cleanCode(v){
  const n=Number(v);
  return Number.isFinite(n)?n:0;
}

export function hardOpsChecks(evidence={}){
  const routes=Array.isArray(evidence.routes)?evidence.routes:[];
  const homepage=routes.find(r=>r.path==='/'||r.name==='homepage')||routes[0]||null;
  const validRoute=r=>{
    const code=cleanCode(r?.http_code);
    return code>=200&&code<400;
  };
  const reachable=routes.filter(validRoute).length;
  const total=routes.length;
  const latestRuns=Array.isArray(evidence.recent_workflow_runs)?evidence.recent_workflow_runs:[];
  const recentCompleted=latestRuns.filter(r=>r.status==='completed').slice(0,5);
  const failedRecent=recentCompleted.filter(r=>['failure','timed_out','cancelled','action_required'].includes(r.conclusion)).length;

  return {
    evidence_present:Boolean(evidence&&typeof evidence==='object'),
    routes_present:total>0,
    homepage_ok:Boolean(homepage&&validRoute(homepage)),
    all_routes_ok:total>0&&routes.every(validRoute),
    reachable_routes:reachable,
    total_routes:total,
    github_status_readable:Boolean(evidence.github_repo&&evidence.github_repo.full_name),
    recent_completed_runs:recentCompleted.length,
    recent_failed_runs:failedRecent
  };
}

export function enforceOpsVerdict(modelVerdict,checks){
  if(!checks.evidence_present||!checks.routes_present||!checks.homepage_ok){
    return {
      status:'INCIDENT',
      severity:'critical',
      recommended_action:'ESCALATE_MANAGER',
      needs_manager_attention:true,
      overridden:true,
      reason:'Homepage or health evidence is unavailable'
    };
  }
  if(!checks.all_routes_ok){
    return {
      status:'DEGRADED',
      severity:'warning',
      recommended_action:modelVerdict?.recommended_action==='ESCALATE_SECURITY'?'ESCALATE_SECURITY':'ESCALATE_DEV',
      needs_manager_attention:true,
      overridden:modelVerdict?.status==='HEALTHY',
      reason:'One or more monitored routes failed'
    };
  }
  if(checks.recent_failed_runs>=2&&modelVerdict?.status==='HEALTHY'){
    return {
      status:'DEGRADED',
      severity:'warning',
      recommended_action:'ESCALATE_MANAGER',
      needs_manager_attention:true,
      overridden:true,
      reason:'Multiple recent workflow failures require attention'
    };
  }
  return {
    status:modelVerdict?.status||'HEALTHY',
    severity:modelVerdict?.severity||'info',
    recommended_action:modelVerdict?.recommended_action||'NO_ACTION',
    needs_manager_attention:Boolean(modelVerdict?.needs_manager_attention),
    overridden:false,
    reason:'Model verdict accepted within hard operational gates'
  };
}

async function ollamaReview({evidence,checks,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}){
  const system=[
    'You are OPS-TB-01, the TrainingBot operations monitoring agent.',
    'You report to TB-01 Director. You are read-only and must never edit source, deploy, change DNS, secrets, accounts, or delete data.',
    'Assess only the supplied evidence. Do not invent root causes.',
    'HEALTHY means monitored routes are reachable and there is no meaningful operational warning in the supplied evidence.',
    'DEGRADED means the service is partially impaired or repeated operational failures deserve attention.',
    'INCIDENT means the primary service is unavailable or evidence shows a severe operational outage.',
    'Use ESCALATE_DEV for likely application/build issues, ESCALATE_SECURITY only when evidence itself indicates a security concern, and ESCALATE_MANAGER when the cause is unclear or cross-team.',
    'Return only structured JSON matching the schema.'
  ].join('\n');

  const user=JSON.stringify({evidence,hard_checks:checks});
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
          format:OPS_SCHEMA,
          options:{temperature:0,num_predict:700},
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
      if(attempt<2) await new Promise(r=>setTimeout(r,1200));
    }finally{
      clearTimeout(timer);
    }
  }
  throw new Error('OPS brain failed after 2 attempts: '+(lastError?.message||String(lastError)));
}

export async function reviewOpsEvidence(evidence,{fetchImpl=fetch}={}){
  const checks=hardOpsChecks(evidence);
  const ai=await ollamaReview({evidence,checks,fetchImpl});
  const guard=enforceOpsVerdict(ai.parsed,checks);
  return {
    agent_id:'OPS-TB-01',
    status:guard.status,
    severity:guard.severity,
    summary:ai.parsed.summary,
    findings:Array.isArray(ai.parsed.findings)?ai.parsed.findings:[],
    recommended_action:guard.recommended_action,
    needs_manager_attention:guard.needs_manager_attention,
    hard_checks:checks,
    hard_gate_overrode_model:guard.overridden,
    hard_gate_reason:guard.reason,
    model:ai.model,
    model_attempt:ai.attempt,
    reviewed_at:new Date().toISOString(),
    source:evidence?.source||'trainingbot-ops-probe'
  };
}

export function renderOpsMarkdown(report,evidence={}){
  const routes=Array.isArray(evidence.routes)?evidence.routes:[];
  const routeLines=routes.map(r=>'- '+(r.path||r.name||'?')+': HTTP '+String(r.http_code||0)+' · '+String(r.time_total_ms||0)+' ms');
  return [
    '# OPS-TB-01 TrainingBot report',
    '',
    '- Status: **'+report.status+'**',
    '- Severity: **'+report.severity+'**',
    '- Recommended action: **'+report.recommended_action+'**',
    '- Manager attention: **'+String(report.needs_manager_attention)+'**',
    '',
    '## Summary',
    report.summary||'No summary',
    '',
    '## Routes',
    ...(routeLines.length?routeLines:['- No route evidence']),
    '',
    '## Hard checks',
    '~~~json',
    JSON.stringify(report.hard_checks,null,2),
    '~~~',
    '',
    'Production changes performed: **NO**'
  ].join('\n');
}

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const cmd=process.argv[2];
  if(cmd!=='review') throw new Error('Usage: node ops-brain.mjs review --evidence <file> --output <file> [--markdown <file>]');
  const evidencePath=arg('--evidence');
  const output=arg('--output');
  const markdown=arg('--markdown');
  if(!evidencePath||!output) throw new Error('Missing --evidence or --output');
  const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
  const report=await reviewOpsEvidence(evidence);
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  if(markdown) fs.writeFileSync(markdown,renderOpsMarkdown(report,evidence)+'\n');
  console.log(JSON.stringify({ok:true,agent_id:report.agent_id,status:report.status,severity:report.severity,recommended_action:report.recommended_action}));
}
