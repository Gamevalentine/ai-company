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
function arr(v,{min=0,max=20,name='array'}={}){
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

export const QA_SCHEMA={
  type:'object',
  properties:{
    verdict:{type:'string',enum:['PASS','FAIL','BLOCKED']},
    summary:{type:'string',maxLength:420},
    test_scope:{type:'array',items:{type:'string',maxLength:240},maxItems:16},
    findings:{
      type:'array',maxItems:16,
      items:{
        type:'object',
        properties:{
          id:{type:'string',maxLength:40},
          severity:{type:'string',enum:['P0','P1','P2','P3','INFO']},
          summary:{type:'string',maxLength:260},
          expected:{type:'string',maxLength:260},
          actual:{type:'string',maxLength:260},
          evidence:{type:'string',maxLength:320},
          suggested_next_role:{type:'string',enum:['NONE','CODE-01','DESIGN-01','SEC-01','PERF-01','SEO-01','OPS-01','CEO']}
        },
        required:['id','severity','summary','expected','actual','evidence','suggested_next_role']
      }
    },
    regression_risks:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    evidence_gaps:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    recommended_next_role:{type:'string',enum:['NONE','CODE-01','DESIGN-01','SEC-01','PERF-01','SEO-01','OPS-01','CEO']}
  },
  required:['verdict','summary','test_scope','findings','regression_risks','evidence_gaps','recommended_next_role']
};

function normalizeCriterion(c,i){
  if(typeof c==='string') return {id:'AC-'+String(i+1).padStart(2,'0'),description:c};
  return {
    id:String(c?.id||('AC-'+String(i+1).padStart(2,'0'))).trim().slice(0,40),
    description:String(c?.description||c?.text||'').trim().slice(0,320)
  };
}

function normalizeQaEvidence(task,evidence={}){
  const criteria=(Array.isArray(task.acceptance_criteria)?task.acceptance_criteria:[])
    .map(normalizeCriterion)
    .filter(x=>x.description);

  const criterionResults=Array.isArray(evidence.criterion_results)
    ? evidence.criterion_results.slice(0,40).map(r=>({
        id:String(r?.id||'').trim().slice(0,40),
        status:['PASS','FAIL','BLOCKED'].includes(r?.status)?r.status:'BLOCKED',
        executed:r?.executed===true,
        evidence:String(r?.evidence||'').trim().slice(0,500)
      }))
    :[];

  const testRuns=Array.isArray(evidence.test_runs)
    ? evidence.test_runs.slice(0,60).map(r=>({
        name:String(r?.name||'').trim().slice(0,160),
        status:['PASS','FAIL','SKIP','BLOCKED'].includes(r?.status)?r.status:'BLOCKED',
        executed:r?.executed===true,
        evidence:String(r?.evidence||'').trim().slice(0,500)
      }))
    :[];

  const defects=Array.isArray(evidence.defects)
    ? evidence.defects.slice(0,30).map((d,i)=>({
        id:String(d?.id||('BUG-'+String(i+1).padStart(2,'0'))).trim().slice(0,40),
        severity:['P0','P1','P2','P3'].includes(d?.severity)?d.severity:'P2',
        open:d?.open!==false,
        summary:String(d?.summary||'').trim().slice(0,280),
        evidence:String(d?.evidence||'').trim().slice(0,500)
      }))
    :[];

  return {
    criteria,
    criterion_results:criterionResults,
    test_runs:testRuns,
    defects,
    version:{
      commit:String(evidence.version?.commit||'').trim().slice(0,80),
      branch:String(evidence.version?.branch||'').trim().slice(0,160),
      artifact:String(evidence.version?.artifact||'').trim().slice(0,240),
      url:String(evidence.version?.url||'').trim().slice(0,500)
    },
    changed_behavior_exercised:evidence.changed_behavior_exercised===true,
    responsive_checked:evidence.responsive_checked===true,
    refresh_navigation_checked:evidence.refresh_navigation_checked===true,
    accessibility_checked:evidence.accessibility_checked===true
  };
}

export function hardQaChecks(task,evidence={}){
  const n=normalizeQaEvidence(task,evidence);
  const byId=new Map(n.criterion_results.map(r=>[r.id,r]));
  const criteria=n.criteria.map(c=>({
    ...c,
    result:byId.get(c.id)||null
  }));
  const unverified=criteria.filter(c=>!c.result||!c.result.executed||!c.result.evidence);
  const failed=criteria.filter(c=>c.result?.executed&&c.result?.status==='FAIL');
  const blocked=criteria.filter(c=>c.result?.status==='BLOCKED'||(c.result&&!c.result.executed));
  const executedTests=n.test_runs.filter(t=>t.executed);
  const failedTests=executedTests.filter(t=>t.status==='FAIL');
  const openBlockers=n.defects.filter(d=>d.open&&['P0','P1'].includes(d.severity));
  const openP2=n.defects.filter(d=>d.open&&d.severity==='P2');
  const versionIdentifiable=Boolean(n.version.commit||n.version.artifact||n.version.url);

  return {
    acceptance_criteria_count:criteria.length,
    acceptance_criteria:criteria,
    unverified_criteria:unverified.map(c=>c.id),
    failed_criteria:failed.map(c=>c.id),
    blocked_criteria:blocked.map(c=>c.id),
    executed_test_count:executedTests.length,
    failed_test_count:failedTests.length,
    open_p0_p1_count:openBlockers.length,
    open_p2_count:openP2.length,
    version_identifiable:versionIdentifiable,
    changed_behavior_exercised:n.changed_behavior_exercised,
    responsive_checked:n.responsive_checked,
    refresh_navigation_checked:n.refresh_navigation_checked,
    accessibility_checked:n.accessibility_checked,
    pass_gate_met:
      criteria.length>0 &&
      unverified.length===0 &&
      failed.length===0 &&
      blocked.length===0 &&
      failedTests.length===0 &&
      openBlockers.length===0 &&
      versionIdentifiable &&
      n.changed_behavior_exercised
  };
}

export function enforceQaVerdict(model,checks){
  if(checks.failed_criteria.length>0||checks.failed_test_count>0||checks.open_p0_p1_count>0){
    return {
      verdict:'FAIL',
      recommended_next_role:model?.recommended_next_role&&model.recommended_next_role!=='NONE'?model.recommended_next_role:'CODE-01',
      overridden:model?.verdict!=='FAIL',
      reason:'Executed evidence contains a failed criterion/test or an open P0/P1 defect.'
    };
  }
  if(!checks.version_identifiable||checks.acceptance_criteria_count===0||checks.unverified_criteria.length>0||!checks.changed_behavior_exercised){
    return {
      verdict:'BLOCKED',
      recommended_next_role:'CEO',
      overridden:model?.verdict!=='BLOCKED',
      reason:'PASS evidence is incomplete: exact version, acceptance criteria, executed evidence, or changed-behavior verification is missing.'
    };
  }
  if(model?.verdict==='PASS'&&!checks.pass_gate_met){
    return {
      verdict:'BLOCKED',
      recommended_next_role:'CEO',
      overridden:true,
      reason:'Model requested PASS but the deterministic PASS gate is not met.'
    };
  }
  return {
    verdict:model?.verdict||'BLOCKED',
    recommended_next_role:model?.recommended_next_role||'NONE',
    overridden:false,
    reason:'Model verdict accepted within deterministic QA gates.'
  };
}

function cleanFindings(v){
  if(!Array.isArray(v)) throw new Error('findings must be an array');
  return v.slice(0,16).map((f,i)=>({
    id:String(f?.id||('QA-'+String(i+1).padStart(2,'0'))).trim().slice(0,40),
    severity:['P0','P1','P2','P3','INFO'].includes(f?.severity)?f.severity:'P2',
    summary:txt(f?.summary,'finding summary',260),
    expected:txt(f?.expected,'finding expected',260),
    actual:txt(f?.actual,'finding actual',260),
    evidence:txt(f?.evidence,'finding evidence',320),
    suggested_next_role:['NONE','CODE-01','DESIGN-01','SEC-01','PERF-01','SEO-01','OPS-01','CEO'].includes(f?.suggested_next_role)?f.suggested_next_role:'CODE-01'
  }));
}

function validateModelOutput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Invalid QA-01 output');
  return {
    verdict:['PASS','FAIL','BLOCKED'].includes(input.verdict)?input.verdict:'BLOCKED',
    summary:txt(input.summary,'summary'),
    test_scope:arr(input.test_scope,{max:16,name:'test_scope'}),
    findings:cleanFindings(input.findings),
    regression_risks:arr(input.regression_risks,{max:12,name:'regression_risks'}),
    evidence_gaps:arr(input.evidence_gaps,{max:12,name:'evidence_gaps'}),
    recommended_next_role:['NONE','CODE-01','DESIGN-01','SEC-01','PERF-01','SEO-01','OPS-01','CEO'].includes(input.recommended_next_role)?input.recommended_next_role:'NONE'
  };
}

async function ask({task,evidence,checks,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}){
  const endpoint=new URL(url);
  if(!['http:','https:'].includes(endpoint.protocol)||!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password){
    throw new Error('QA-01 requires a local Ollama endpoint');
  }
  const system=[
    'You are QA-01, the independent quality-assurance engineer in AION HQ.',
    'You report directly to CEO ATLAS and are independent from CODE-01 and every implementer.',
    'Assess only supplied QA evidence. Never invent test execution, browser interaction, reproduction, screenshots, logs, source inspection, deployment, or live verification.',
    'PASS requires explicit evidence for every acceptance criterion, an identifiable tested version, changed behavior actually exercised, and no open P0/P1 blocker.',
    'FAIL when executed evidence shows a failed required criterion, failed material test, or open P0/P1 defect.',
    'BLOCKED when evidence, environment, version, access, or execution proof is insufficient.',
    'Do not edit source, weaken acceptance criteria, deploy, spend money, delete data, or change secrets.',
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
          model,stream:false,format:QA_SCHEMA,
          options:{temperature:0,num_predict:1600},
          messages:[
            {role:'system',content:system},
            {role:'user',content:JSON.stringify({task,qa_evidence:evidence,hard_checks:checks})}
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
  throw new Error('QA-01 model failed after at most two attempts: '+(lastError?.message||String(lastError)));
}

export async function runQa01Brain(inputState,{taskId,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}={}){
  const s=ensureArrays(clone(inputState));
  const task=s.tasks.find(t=>t.task_id===taskId);
  if(!task) throw new Error('Task not found: '+taskId);
  if(task.assigned_to!=='QA-01') throw new Error('QA-01 cannot process task assigned to '+task.assigned_to);
  if(task.created_by!=='ATLAS') throw new Error('QA-01 tasks must be assigned by ATLAS');

  const evidence=task.inputs?.qa_evidence||{};
  const checks=hardQaChecks(task,evidence);
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
  const gate=enforceQaVerdict(modelReport,checks);

  const report={
    evidence_id:uid('EVD'),
    agent_id:'QA-01',
    task_id:task.task_id,
    at:now(),
    type:'QA_HANDOFF',
    verdict:gate.verdict,
    summary:modelReport.summary,
    test_scope:modelReport.test_scope,
    findings:modelReport.findings,
    regression_risks:modelReport.regression_risks,
    evidence_gaps:modelReport.evidence_gaps,
    recommended_next_role:gate.recommended_next_role,
    hard_checks:checks,
    hard_gate_overrode_model:gate.overridden,
    hard_gate_reason:gate.reason,
    model:ai.model,
    model_attempt:ai.attempt,
    claims_direct_test_execution:false
  };

  task.outputs=task.outputs||{};
  task.outputs.qa_handoff=report;
  task.evidence=Array.isArray(task.evidence)?task.evidence:[];
  task.evidence.push(report);
  task.status=report.verdict==='PASS'?'QA_PASS':(report.verdict==='FAIL'?'QA_FAIL':'QA_BLOCKED');
  task.updated_at=now();

  const type=report.verdict==='PASS'?'QA_PASS_READY':(report.verdict==='FAIL'?'QA_FAIL_REPORTED':'QA_BLOCKED_REPORTED');
  message(s,{
    task_id:task.task_id,
    from:'QA-01',
    to:'ATLAS',
    type,
    payload:{
      verdict:report.verdict,
      recommended_next_role:report.recommended_next_role,
      failed_criteria:checks.failed_criteria,
      unverified_criteria:checks.unverified_criteria,
      open_p0_p1_count:checks.open_p0_p1_count
    }
  });
  audit(s,{
    actor:'QA-01',
    action:type,
    task_id:task.task_id,
    target:'ATLAS',
    result:task.status,
    model:ai.model
  });
  s.updated_at=now();
  return {state:s,report};
}

export function qa01Summary(state,taskId){
  const task=(state.tasks||[]).find(t=>t.task_id===taskId);
  if(!task) return {task_id:taskId,status:'NOT_FOUND'};
  return {
    task_id:taskId,
    assigned_to:task.assigned_to,
    status:task.status,
    qa_handoff:task.outputs?.qa_handoff||null,
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
  if(!statePath||!taskId) throw new Error('Usage: node qa-01-brain.mjs <run|summary> --state <file> --task-id <id> [--output <file>]');
  const current=JSON.parse(fs.readFileSync(statePath,'utf8'));
  if(cmd==='run'){
    const out=await runQa01Brain(current,{taskId});
    fs.writeFileSync(statePath,JSON.stringify(out.state,null,2)+'\n');
    if(output) fs.writeFileSync(output,JSON.stringify(out.report,null,2)+'\n');
    else console.log(JSON.stringify(out.report,null,2));
  }else if(cmd==='summary'){
    const out=qa01Summary(current,taskId);
    if(output) fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
    else console.log(JSON.stringify(out,null,2));
  }else throw new Error('Unknown command: '+cmd);
}
