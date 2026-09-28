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
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }

export const PERF_SCHEMA={
  type:'object',
  properties:{
    status:{type:'string',enum:['NEEDS_MEASUREMENT','NEEDS_ATTENTION','READY_FOR_CEO_REVIEW']},
    summary:{type:'string',maxLength:420},
    target:{type:'string',maxLength:320},
    root_cause:{type:'string',maxLength:420},
    bottlenecks:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    recommendations:{type:'array',items:{type:'string',maxLength:260},maxItems:12},
    verification_notes:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    remaining_risks:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    rollback_path:{type:'string',maxLength:320},
    recommended_next_role:{type:'string',enum:['NONE','CODE-01','QA-01','OPS-01','CEO']},
    owner_decision_required:{type:'boolean'},
    owner_decision_reason:{type:'string',maxLength:320}
  },
  required:[
    'status','summary','target','root_cause','bottlenecks','recommendations',
    'verification_notes','remaining_risks','rollback_path','recommended_next_role',
    'owner_decision_required','owner_decision_reason'
  ]
};

function normalizeMeasurement(m){
  if(!m||typeof m!=='object') return null;
  const metric=String(m.metric||'').trim();
  const value=num(m.value);
  const unit=String(m.unit||'').trim();
  if(!metric||value===null||!unit) return null;
  return {
    metric:metric.slice(0,80),
    value,
    unit:unit.slice(0,24),
    lower_is_better:m.lower_is_better!==false
  };
}

function normalizeMeasurementSet(set){
  const list=Array.isArray(set?.measurements)?set.measurements.map(normalizeMeasurement).filter(Boolean):[];
  return {
    available:set?.available===true&&list.length>0,
    method:String(set?.method||'').trim().slice(0,120),
    environment:String(set?.environment||'').trim().slice(0,180),
    device:String(set?.device||'').trim().slice(0,120),
    network:String(set?.network||'').trim().slice(0,120),
    repeat_count:Number.isInteger(Number(set?.repeat_count))?Math.max(0,Number(set.repeat_count)):0,
    measurements:list
  };
}

export function computeMetricDeltas(baselineSet,afterSet){
  const baseline=normalizeMeasurementSet(baselineSet);
  const after=normalizeMeasurementSet(afterSet);
  const byKey=new Map(after.measurements.map(m=>[m.metric+'|'+m.unit,m]));
  const deltas=[];
  for(const b of baseline.measurements){
    const a=byKey.get(b.metric+'|'+b.unit);
    if(!a) continue;
    const delta=a.value-b.value;
    const pct=b.value===0?null:(delta/b.value)*100;
    const improved=b.lower_is_better ? a.value<b.value : a.value>b.value;
    const regressed=b.lower_is_better ? a.value>b.value : a.value<b.value;
    deltas.push({
      metric:b.metric,
      unit:b.unit,
      before:b.value,
      after:a.value,
      delta,
      percent_change:pct===null?null:Number(pct.toFixed(2)),
      lower_is_better:b.lower_is_better,
      improved,
      regressed
    });
  }
  return {baseline,after,deltas};
}

export function hardPerfChecks(evidence={}){
  const {baseline,after,deltas}=computeMetricDeltas(evidence.baseline,evidence.after);
  const baselineAvailable=baseline.available;
  const afterAvailable=after.available;
  const hasExplicitComparable=Object.prototype.hasOwnProperty.call(evidence,'comparable_conditions');
  const matchingContext=
    baselineAvailable&&afterAvailable&&
    baseline.method&&after.method&&baseline.method===after.method&&
    baseline.environment&&after.environment&&baseline.environment===after.environment&&
    baseline.device===after.device&&baseline.network===after.network;
  const comparable=hasExplicitComparable
    ? evidence.comparable_conditions===true
    : Boolean(matchingContext);
  const matchedMetrics=deltas.length;
  const regressions=deltas.filter(d=>d.regressed);
  const improvements=deltas.filter(d=>d.improved);
  const regressionChecks=evidence.regression_checks||{};
  return {
    baseline_available:baselineAvailable,
    after_available:afterAvailable,
    comparable_conditions:comparable,
    matched_metric_count:matchedMetrics,
    improvements,
    regressions,
    functional_regression_check:regressionChecks.functional_pass===true,
    visual_regression_check:regressionChecks.visual_pass===true,
    security_regression_check:regressionChecks.security_pass===true,
    seo_regression_check:regressionChecks.seo_pass===true,
    evidence_can_verify_change:baselineAvailable&&afterAvailable&&comparable&&matchedMetrics>0
  };
}

export function enforcePerfVerdict(model,checks){
  const claimsImprovement=model?.status==='READY_FOR_CEO_REVIEW' &&
    /improv|faster|reduc|better|gain/i.test(String(model?.summary||'')+' '+String(model?.verification_notes||''));
  if(claimsImprovement&&!checks.evidence_can_verify_change){
    return {
      status:'NEEDS_MEASUREMENT',
      recommended_next_role:'NONE',
      owner_decision_required:false,
      overridden:true,
      reason:'Before/after performance evidence is not sufficient to verify improvement.'
    };
  }
  if(checks.regressions.length>0){
    return {
      status:'NEEDS_ATTENTION',
      recommended_next_role:model?.recommended_next_role==='OPS-01'?'OPS-01':'CODE-01',
      owner_decision_required:Boolean(model?.owner_decision_required),
      overridden:model?.status==='READY_FOR_CEO_REVIEW',
      reason:'Comparable evidence contains one or more performance regressions.'
    };
  }
  if(!checks.baseline_available){
    return {
      status:'NEEDS_MEASUREMENT',
      recommended_next_role:'NONE',
      owner_decision_required:false,
      overridden:model?.status!=='NEEDS_MEASUREMENT',
      reason:'A baseline is required before claiming optimization results.'
    };
  }
  return {
    status:model?.status||'NEEDS_ATTENTION',
    recommended_next_role:model?.recommended_next_role||'NONE',
    owner_decision_required:Boolean(model?.owner_decision_required),
    overridden:false,
    reason:'Model verdict accepted within performance evidence gates.'
  };
}

async function ask({task,evidence,checks,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}){
  const endpoint=new URL(url);
  if(!['http:','https:'].includes(endpoint.protocol)||!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password){
    throw new Error('PERF-01 requires a local Ollama endpoint');
  }
  const system=[
    'You are PERF-01, the independent performance engineer in AION HQ.',
    'You report directly to CEO ATLAS.',
    'Assess only supplied performance evidence. Never invent Lighthouse, PageSpeed, Core Web Vitals, API, server, database, CPU, memory, bundle, or production measurements.',
    'Never say faster, improved, fixed, measured, tested, deployed, or live unless the supplied evidence supports that exact claim.',
    'Separate symptoms from root cause. Prefer the smallest high-impact reversible recommendation.',
    'Do not trade correctness, accessibility, SEO, or security for speed.',
    'Do not edit source, deploy, spend money, or make destructive changes.',
    'Use CODE-01 for code optimization, QA-01 for regression verification, OPS-01 for operational/configuration work, and CEO for material product/cost decisions.',
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
          model,stream:false,format:PERF_SCHEMA,
          options:{temperature:0.1,num_predict:1400},
          messages:[
            {role:'system',content:system},
            {role:'user',content:JSON.stringify({task,performance_evidence:evidence,hard_checks:checks})}
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
  throw new Error('PERF-01 model failed after at most two attempts: '+(lastError?.message||String(lastError)));
}

function validateModelOutput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Invalid PERF-01 output');
  return {
    status:['NEEDS_MEASUREMENT','NEEDS_ATTENTION','READY_FOR_CEO_REVIEW'].includes(input.status)?input.status:'NEEDS_ATTENTION',
    summary:txt(input.summary,'summary'),
    target:txt(input.target,'target',320),
    root_cause:txt(input.root_cause,'root_cause'),
    bottlenecks:arr(input.bottlenecks,{max:12,name:'bottlenecks'}),
    recommendations:arr(input.recommendations,{max:12,name:'recommendations'}),
    verification_notes:arr(input.verification_notes,{max:12,name:'verification_notes'}),
    remaining_risks:arr(input.remaining_risks,{max:12,name:'remaining_risks'}),
    rollback_path:txt(input.rollback_path,'rollback_path',320),
    recommended_next_role:['NONE','CODE-01','QA-01','OPS-01','CEO'].includes(input.recommended_next_role)?input.recommended_next_role:'NONE',
    owner_decision_required:Boolean(input.owner_decision_required),
    owner_decision_reason:String(input.owner_decision_reason||'').trim().slice(0,320)
  };
}

export async function runPerfBrain(inputState,{taskId,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}={}){
  const s=ensureArrays(clone(inputState));
  const task=s.tasks.find(t=>t.task_id===taskId);
  if(!task) throw new Error('Task not found: '+taskId);
  if(task.assigned_to!=='PERF-01') throw new Error('PERF-01 cannot process task assigned to '+task.assigned_to);
  if(task.created_by!=='ATLAS') throw new Error('PERF-01 tasks must be assigned by ATLAS');

  const evidence=task.inputs?.performance_evidence||{};
  const checks=hardPerfChecks(evidence);
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
  const gate=enforcePerfVerdict(modelReport,checks);
  const delta=computeMetricDeltas(evidence.baseline,evidence.after);

  const report={
    evidence_id:uid('EVD'),
    agent_id:'PERF-01',
    task_id:task.task_id,
    at:now(),
    type:'PERFORMANCE_HANDOFF',
    status:gate.status,
    summary:modelReport.summary,
    target:modelReport.target,
    root_cause:modelReport.root_cause,
    bottlenecks:modelReport.bottlenecks,
    recommendations:modelReport.recommendations,
    verification_notes:modelReport.verification_notes,
    remaining_risks:modelReport.remaining_risks,
    rollback_path:modelReport.rollback_path,
    recommended_next_role:gate.recommended_next_role,
    owner_decision_required:gate.owner_decision_required,
    owner_decision_reason:modelReport.owner_decision_reason,
    baseline:delta.baseline,
    after:delta.after,
    metric_deltas:delta.deltas,
    hard_checks:checks,
    hard_gate_overrode_model:gate.overridden,
    hard_gate_reason:gate.reason,
    model:ai.model,
    model_attempt:ai.attempt,
    claims_direct_benchmark_execution:false
  };

  task.outputs=task.outputs||{};
  task.outputs.performance_handoff=report;
  task.evidence=Array.isArray(task.evidence)?task.evidence:[];
  task.evidence.push(report);
  task.status=report.owner_decision_required?'WAITING_CEO_DECISION':report.status;
  task.updated_at=now();

  const type=report.owner_decision_required
    ?'PERFORMANCE_DECISION_REQUIRED'
    :(report.status==='NEEDS_MEASUREMENT'?'PERFORMANCE_MEASUREMENT_REQUIRED':'PERFORMANCE_HANDOFF_READY');
  message(s,{
    task_id:task.task_id,
    from:'PERF-01',
    to:'ATLAS',
    type,
    payload:{
      status:task.status,
      recommended_next_role:report.recommended_next_role,
      regression_count:checks.regressions.length,
      matched_metric_count:checks.matched_metric_count,
      owner_decision_required:report.owner_decision_required
    }
  });
  audit(s,{
    actor:'PERF-01',
    action:type,
    task_id:task.task_id,
    target:'ATLAS',
    result:task.status,
    model:ai.model
  });
  s.updated_at=now();
  return {state:s,report};
}

export function perfSummary(state,taskId){
  const task=(state.tasks||[]).find(t=>t.task_id===taskId);
  if(!task) return {task_id:taskId,status:'NOT_FOUND'};
  return {
    task_id:taskId,
    assigned_to:task.assigned_to,
    status:task.status,
    performance_handoff:task.outputs?.performance_handoff||null,
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
  if(!statePath||!taskId) throw new Error('Usage: node perf-01-brain.mjs <run|summary> --state <file> --task-id <id> [--output <file>]');
  const current=JSON.parse(fs.readFileSync(statePath,'utf8'));
  if(cmd==='run'){
    const out=await runPerfBrain(current,{taskId});
    fs.writeFileSync(statePath,JSON.stringify(out.state,null,2)+'\n');
    if(output) fs.writeFileSync(output,JSON.stringify(out.report,null,2)+'\n');
    else console.log(JSON.stringify(out.report,null,2));
  }else if(cmd==='summary'){
    const out=perfSummary(current,taskId);
    if(output) fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
    else console.log(JSON.stringify(out,null,2));
  }else throw new Error('Unknown command: '+cmd);
}
