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
function bool(v){ return v===true; }

export const SEO_SCHEMA={
  type:'object',
  properties:{
    status:{type:'string',enum:['NEEDS_EVIDENCE','NEEDS_ATTENTION','READY_FOR_CEO_REVIEW']},
    summary:{type:'string',maxLength:420},
    target:{type:'string',maxLength:320},
    findings:{
      type:'array',maxItems:16,
      items:{
        type:'object',
        properties:{
          severity:{type:'string',enum:['critical','high','medium','low','info']},
          area:{type:'string',maxLength:80},
          finding:{type:'string',maxLength:260},
          evidence:{type:'string',maxLength:260}
        },
        required:['severity','area','finding','evidence']
      }
    },
    recommendations:{type:'array',items:{type:'string',maxLength:280},maxItems:16},
    verification_plan:{type:'array',items:{type:'string',maxLength:260},maxItems:12},
    evidence_gaps:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    recommended_next_role:{type:'string',enum:['NONE','CODE-01','PERF-01','QA-01','OPS-01','CEO']},
    owner_decision_required:{type:'boolean'},
    owner_decision_reason:{type:'string',maxLength:320}
  },
  required:[
    'status','summary','target','findings','recommendations','verification_plan',
    'evidence_gaps','recommended_next_role','owner_decision_required','owner_decision_reason'
  ]
};

function normalizePages(pages){
  if(!Array.isArray(pages)) return [];
  return pages.slice(0,50).map(p=>({
    url:String(p?.url||'').trim().slice(0,500),
    title:String(p?.title||'').trim().slice(0,180),
    meta_description:String(p?.meta_description||'').trim().slice(0,320),
    canonical:String(p?.canonical||'').trim().slice(0,500),
    robots:String(p?.robots||'').trim().toLowerCase().slice(0,120),
    h1_count:Number.isFinite(Number(p?.h1_count))?Number(p.h1_count):null,
    schema_types:Array.isArray(p?.schema_types)?p.schema_types.map(x=>String(x).trim()).filter(Boolean).slice(0,12):[],
    status_code:Number.isFinite(Number(p?.status_code))?Number(p.status_code):null
  })).filter(p=>p.url);
}

export function hardSeoChecks(evidence={}){
  const pages=normalizePages(evidence.pages);
  const robots=evidence.robots_txt||{};
  const sitemap=evidence.sitemap||{};
  const sc=evidence.search_console||{};
  const serp=evidence.serp||{};
  const changes=evidence.changes||{};
  const targetPublic=evidence.target_public!==false;

  const noindexPages=pages.filter(p=>/\bnoindex\b/.test(p.robots));
  const missingTitle=pages.filter(p=>!p.title);
  const missingDescription=pages.filter(p=>!p.meta_description);
  const missingCanonical=pages.filter(p=>!p.canonical);
  const badStatus=pages.filter(p=>p.status_code!==null && (p.status_code<200||p.status_code>=400));
  const duplicateTitles=[];
  const titleMap=new Map();
  for(const p of pages){
    if(!p.title) continue;
    const key=p.title.toLowerCase();
    if(!titleMap.has(key)) titleMap.set(key,[]);
    titleMap.get(key).push(p.url);
  }
  for(const [title,urls] of titleMap) if(urls.length>1) duplicateTitles.push({title,urls});

  const searchConsoleAvailable=sc.available===true;
  const serpAvailable=serp.available===true;
  const implementationVerified=changes.implemented===true && changes.verified===true;
  const productionVerified=changes.deployed===true && changes.live_verified===true;

  const critical=[];
  if(targetPublic && robots.blocked_target===true) critical.push('Target page/site is blocked by robots.txt evidence.');
  if(targetPublic && noindexPages.length>0) critical.push('One or more target public pages contain noindex evidence.');
  if(targetPublic && pages.length>0 && badStatus.length>0) critical.push('One or more target pages return non-indexable HTTP status evidence.');

  const attention=[];
  if(pages.length===0) attention.push('No page-level SEO evidence was supplied.');
  if(missingTitle.length>0) attention.push('Missing title tags detected.');
  if(missingDescription.length>0) attention.push('Missing meta descriptions detected.');
  if(missingCanonical.length>0) attention.push('Missing canonical tags detected.');
  if(duplicateTitles.length>0) attention.push('Duplicate title tags detected.');
  if(sitemap.available===false) attention.push('Sitemap evidence is unavailable.');
  if(sitemap.valid===false) attention.push('Sitemap evidence indicates invalid or unusable sitemap.');

  return {
    page_count:pages.length,
    pages,
    noindex_pages:noindexPages.map(p=>p.url),
    missing_title_pages:missingTitle.map(p=>p.url),
    missing_description_pages:missingDescription.map(p=>p.url),
    missing_canonical_pages:missingCanonical.map(p=>p.url),
    bad_status_pages:badStatus.map(p=>({url:p.url,status_code:p.status_code})),
    duplicate_titles:duplicateTitles,
    robots_blocks_target:robots.blocked_target===true,
    sitemap_available:sitemap.available===true,
    sitemap_valid:sitemap.valid===true,
    search_console_available:searchConsoleAvailable,
    serp_evidence_available:serpAvailable,
    implementation_verified:implementationVerified,
    production_verified:productionVerified,
    critical,
    attention
  };
}

function modelClaims(input){
  const text=[
    input?.summary,
    ...(Array.isArray(input?.recommendations)?input.recommendations:[]),
    ...(Array.isArray(input?.verification_plan)?input.verification_plan:[])
  ].join(' ').toLowerCase();
  return {
    indexing:/\b(indexed|indexing improved|google indexed|đã index|được index|lập chỉ mục thành công)\b/i.test(text),
    ranking:/\b(rank|ranking|position improved|traffic increased|organic traffic grew|tăng thứ hạng|tăng traffic|tăng truy cập tự nhiên)\b/i.test(text),
    implementation:/\b(fixed|implemented|changed|updated source|đã sửa|đã triển khai|deployed|live)\b/i.test(text)
  };
}

export function enforceSeoVerdict(model,checks){
  const claims=modelClaims(model);
  if((claims.indexing&&!checks.search_console_available) || (claims.ranking&&!checks.serp_evidence_available&&!checks.search_console_available)){
    return {
      status:'NEEDS_EVIDENCE',
      recommended_next_role:'NONE',
      owner_decision_required:false,
      overridden:true,
      reason:'Indexing/ranking/traffic claims are not backed by Search Console or SERP evidence.'
    };
  }
  if(claims.implementation&&!checks.implementation_verified){
    return {
      status:'NEEDS_EVIDENCE',
      recommended_next_role:model?.recommended_next_role||'CODE-01',
      owner_decision_required:Boolean(model?.owner_decision_required),
      overridden:true,
      reason:'Implementation/deployment claims are not backed by verified change evidence.'
    };
  }
  if(checks.critical.length>0){
    return {
      status:'NEEDS_ATTENTION',
      recommended_next_role:model?.recommended_next_role==='OPS-01'?'OPS-01':'CODE-01',
      owner_decision_required:Boolean(model?.owner_decision_required),
      overridden:model?.status==='READY_FOR_CEO_REVIEW',
      reason:'Hard SEO evidence contains crawlability/indexability blockers.'
    };
  }
  if(checks.attention.length>0 && model?.status==='READY_FOR_CEO_REVIEW'){
    return {
      status:'NEEDS_ATTENTION',
      recommended_next_role:model?.recommended_next_role||'CODE-01',
      owner_decision_required:Boolean(model?.owner_decision_required),
      overridden:true,
      reason:'SEO evidence contains unresolved technical/on-page findings.'
    };
  }
  return {
    status:model?.status||'NEEDS_ATTENTION',
    recommended_next_role:model?.recommended_next_role||'NONE',
    owner_decision_required:Boolean(model?.owner_decision_required),
    overridden:false,
    reason:'Model verdict accepted within SEO evidence gates.'
  };
}

function cleanFindings(v){
  if(!Array.isArray(v)) throw new Error('findings must be an array');
  return v.slice(0,16).map(f=>({
    severity:['critical','high','medium','low','info'].includes(f?.severity)?f.severity:'medium',
    area:txt(f?.area,'finding area',80),
    finding:txt(f?.finding,'finding',260),
    evidence:txt(f?.evidence,'finding evidence',260)
  }));
}

function validateModelOutput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Invalid SEO-01 output');
  return {
    status:['NEEDS_EVIDENCE','NEEDS_ATTENTION','READY_FOR_CEO_REVIEW'].includes(input.status)?input.status:'NEEDS_ATTENTION',
    summary:txt(input.summary,'summary'),
    target:txt(input.target,'target',320),
    findings:cleanFindings(input.findings),
    recommendations:arr(input.recommendations,{max:16,name:'recommendations'}),
    verification_plan:arr(input.verification_plan,{max:12,name:'verification_plan'}),
    evidence_gaps:arr(input.evidence_gaps,{max:12,name:'evidence_gaps'}),
    recommended_next_role:['NONE','CODE-01','PERF-01','QA-01','OPS-01','CEO'].includes(input.recommended_next_role)?input.recommended_next_role:'NONE',
    owner_decision_required:bool(input.owner_decision_required),
    owner_decision_reason:String(input.owner_decision_reason||'').trim().slice(0,320)
  };
}

async function ask({task,evidence,checks,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}){
  const endpoint=new URL(url);
  if(!['http:','https:'].includes(endpoint.protocol)||!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password){
    throw new Error('SEO-01 requires a local Ollama endpoint');
  }

  const system=[
    'You are SEO-01, the independent SEO specialist in AION HQ.',
    'You report directly to CEO ATLAS.',
    'Assess only supplied evidence. Never invent rankings, traffic, search volume, indexing state, Search Console data, SERP results, source edits, deployment, or live verification.',
    'Classify confirmed evidence separately from recommendations and evidence gaps.',
    'Treat crawl/index blockers as technical issues that need attention, not as proof of ranking loss.',
    'Do not use doorway pages, keyword stuffing, hidden text, link spam, deceptive schema, or manipulative tactics.',
    'Do not edit source, publish content, deploy, spend money, or change production.',
    'Use CODE-01 for source changes, PERF-01 for performance issues, QA-01 for verification, OPS-01 for operational changes, and CEO for material decisions.',
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
          model,stream:false,format:SEO_SCHEMA,
          options:{temperature:0.1,num_predict:1600},
          messages:[
            {role:'system',content:system},
            {role:'user',content:JSON.stringify({task,seo_evidence:evidence,hard_checks:checks})}
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
  throw new Error('SEO-01 model failed after at most two attempts: '+(lastError?.message||String(lastError)));
}

export async function runSeoBrain(inputState,{taskId,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}={}){
  const s=ensureArrays(clone(inputState));
  const task=s.tasks.find(t=>t.task_id===taskId);
  if(!task) throw new Error('Task not found: '+taskId);
  if(task.assigned_to!=='SEO-01') throw new Error('SEO-01 cannot process task assigned to '+task.assigned_to);
  if(task.created_by!=='ATLAS') throw new Error('SEO-01 tasks must be assigned by ATLAS');

  const evidence=task.inputs?.seo_evidence||{};
  const checks=hardSeoChecks(evidence);
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
  const gate=enforceSeoVerdict(modelReport,checks);

  const report={
    evidence_id:uid('EVD'),
    agent_id:'SEO-01',
    task_id:task.task_id,
    at:now(),
    type:'SEO_HANDOFF',
    status:gate.status,
    summary:modelReport.summary,
    target:modelReport.target,
    findings:modelReport.findings,
    recommendations:modelReport.recommendations,
    verification_plan:modelReport.verification_plan,
    evidence_gaps:modelReport.evidence_gaps,
    recommended_next_role:gate.recommended_next_role,
    owner_decision_required:gate.owner_decision_required,
    owner_decision_reason:modelReport.owner_decision_reason,
    hard_checks:checks,
    hard_gate_overrode_model:gate.overridden,
    hard_gate_reason:gate.reason,
    model:ai.model,
    model_attempt:ai.attempt,
    claims_direct_web_or_search_console_access:false,
    claims_source_change_performed:false
  };

  task.outputs=task.outputs||{};
  task.outputs.seo_handoff=report;
  task.evidence=Array.isArray(task.evidence)?task.evidence:[];
  task.evidence.push(report);
  task.status=report.owner_decision_required?'WAITING_CEO_DECISION':report.status;
  task.updated_at=now();

  const type=report.owner_decision_required
    ?'SEO_DECISION_REQUIRED'
    :(report.status==='NEEDS_EVIDENCE'?'SEO_EVIDENCE_REQUIRED':'SEO_HANDOFF_READY');
  message(s,{
    task_id:task.task_id,
    from:'SEO-01',
    to:'ATLAS',
    type,
    payload:{
      status:task.status,
      recommended_next_role:report.recommended_next_role,
      critical_count:checks.critical.length,
      evidence_gap_count:report.evidence_gaps.length,
      owner_decision_required:report.owner_decision_required
    }
  });
  audit(s,{
    actor:'SEO-01',
    action:type,
    task_id:task.task_id,
    target:'ATLAS',
    result:task.status,
    model:ai.model
  });
  s.updated_at=now();
  return {state:s,report};
}

export function seoSummary(state,taskId){
  const task=(state.tasks||[]).find(t=>t.task_id===taskId);
  if(!task) return {task_id:taskId,status:'NOT_FOUND'};
  return {
    task_id:taskId,
    assigned_to:task.assigned_to,
    status:task.status,
    seo_handoff:task.outputs?.seo_handoff||null,
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
  if(!statePath||!taskId) throw new Error('Usage: node seo-01-brain.mjs <run|summary> --state <file> --task-id <id> [--output <file>]');
  const current=JSON.parse(fs.readFileSync(statePath,'utf8'));
  if(cmd==='run'){
    const out=await runSeoBrain(current,{taskId});
    fs.writeFileSync(statePath,JSON.stringify(out.state,null,2)+'\n');
    if(output) fs.writeFileSync(output,JSON.stringify(out.report,null,2)+'\n');
    else console.log(JSON.stringify(out.report,null,2));
  }else if(cmd==='summary'){
    const out=seoSummary(current,taskId);
    if(output) fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
    else console.log(JSON.stringify(out,null,2));
  }else throw new Error('Unknown command: '+cmd);
}
