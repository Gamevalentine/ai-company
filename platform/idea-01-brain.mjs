import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_MODEL=process.env.AION_LOCAL_MODEL||'qwen2.5:1.5b-instruct';
const DEFAULT_URL=process.env.OLLAMA_URL||'http://127.0.0.1:11434';
const ALLOWED_ASSIGNEES=new Set(['DESIGN-01','CODE-01','QA-01','SEC-01','PERF-01','SEO-01','OPS-01','TB-01']);

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
function strings(v,{min=0,max=20,name='array'}={}){
  if(!Array.isArray(v)) throw new Error(name+' must be an array');
  const out=v.map(x=>String(x||'').trim()).filter(Boolean).slice(0,max);
  if(out.length<min) throw new Error(name+' requires at least '+min+' item(s)');
  return out;
}
function text(v,name,max=500){
  const out=String(v??'').trim();
  if(!out) throw new Error(name+' is required');
  return out.slice(0,max);
}

export const IDEA_SCHEMA={
  type:'object',
  properties:{
    status:{type:'string',enum:['READY_FOR_CEO_REVIEW','NEEDS_DECISION']},
    summary:{type:'string',maxLength:420},
    problem:{type:'string',maxLength:420},
    goal:{type:'string',maxLength:420},
    target_users:{type:'array',items:{type:'string',maxLength:180},minItems:1,maxItems:8},
    confirmed_facts:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    assumptions:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    proposals:{type:'array',items:{type:'string',maxLength:240},maxItems:12},
    scope_in:{type:'array',items:{type:'string',maxLength:220},minItems:1,maxItems:16},
    scope_out:{type:'array',items:{type:'string',maxLength:220},maxItems:16},
    non_goals:{type:'array',items:{type:'string',maxLength:220},maxItems:12},
    requirements:{
      type:'array',minItems:1,maxItems:20,
      items:{
        type:'object',
        properties:{
          id:{type:'string',maxLength:30},
          priority:{type:'string',enum:['must','should','could']},
          description:{type:'string',maxLength:280}
        },
        required:['id','priority','description']
      }
    },
    user_flow:{type:'array',items:{type:'string',maxLength:240},minItems:1,maxItems:16},
    acceptance_criteria:{type:'array',items:{type:'string',maxLength:260},minItems:1,maxItems:16},
    dependencies:{type:'array',items:{type:'string',maxLength:220},maxItems:12},
    risks:{
      type:'array',maxItems:12,
      items:{
        type:'object',
        properties:{
          risk:{type:'string',maxLength:240},
          mitigation:{type:'string',maxLength:240}
        },
        required:['risk','mitigation']
      }
    },
    recommended_assignees:{type:'array',items:{type:'string',maxLength:40},maxItems:8},
    decisions_required:{type:'array',items:{type:'string',maxLength:260},maxItems:8}
  },
  required:[
    'status','summary','problem','goal','target_users','confirmed_facts','assumptions','proposals',
    'scope_in','scope_out','non_goals','requirements','user_flow','acceptance_criteria',
    'dependencies','risks','recommended_assignees','decisions_required'
  ]
};

function cleanRequirements(v){
  if(!Array.isArray(v)||v.length===0) throw new Error('requirements requires at least 1 item');
  return v.slice(0,20).map((r,i)=>{
    if(!r||typeof r!=='object') throw new Error('invalid requirement');
    const priority=['must','should','could'].includes(r.priority)?r.priority:'must';
    return {
      id:String(r.id||('REQ-'+String(i+1).padStart(2,'0'))).trim().slice(0,30),
      priority,
      description:text(r.description,'requirement description',280)
    };
  });
}
function cleanRisks(v){
  if(!Array.isArray(v)) throw new Error('risks must be an array');
  return v.slice(0,12).map(r=>({
    risk:text(r?.risk,'risk',240),
    mitigation:text(r?.mitigation,'mitigation',240)
  }));
}

export function validateIdeaBrief(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Invalid IDEA-01 output');
  const recommended=[...new Set(strings(input.recommended_assignees,{max:8,name:'recommended_assignees'}))]
    .filter(x=>ALLOWED_ASSIGNEES.has(x));
  const decisions=strings(input.decisions_required,{max:8,name:'decisions_required'});
  return {
    status:decisions.length?'NEEDS_DECISION':'READY_FOR_CEO_REVIEW',
    summary:text(input.summary,'summary',420),
    problem:text(input.problem,'problem',420),
    goal:text(input.goal,'goal',420),
    target_users:strings(input.target_users,{min:1,max:8,name:'target_users'}),
    confirmed_facts:strings(input.confirmed_facts,{max:12,name:'confirmed_facts'}),
    assumptions:strings(input.assumptions,{max:12,name:'assumptions'}),
    proposals:strings(input.proposals,{max:12,name:'proposals'}),
    scope:{
      in:strings(input.scope_in,{min:1,max:16,name:'scope_in'}),
      out:strings(input.scope_out,{max:16,name:'scope_out'}),
      non_goals:strings(input.non_goals,{max:12,name:'non_goals'})
    },
    requirements:cleanRequirements(input.requirements),
    user_flow:strings(input.user_flow,{min:1,max:16,name:'user_flow'}),
    acceptance_criteria:strings(input.acceptance_criteria,{min:1,max:16,name:'acceptance_criteria'}),
    dependencies:strings(input.dependencies,{max:12,name:'dependencies'}),
    risks:cleanRisks(input.risks),
    recommended_assignees:recommended,
    decisions_required:decisions
  };
}

async function ask({task,context,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}){
  const endpoint=new URL(url);
  if(!['http:','https:'].includes(endpoint.protocol)||!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password){
    throw new Error('IDEA-01 requires a local Ollama endpoint');
  }
  const system=[
    'You are IDEA-01, the product ideation and requirements analyst in AION HQ.',
    'You report directly to CEO ATLAS and never delegate directly.',
    'Turn the supplied goal and authorized context into a testable implementation brief.',
    'Use only supplied facts. Never claim you inspected source, analytics, users, production, or external systems unless that evidence is in the supplied context.',
    'Separate confirmed_facts, assumptions, and proposals.',
    'Prefer the smallest coherent scope that achieves the stated goal.',
    'Acceptance criteria must be observable and testable.',
    'Only recommend these assignees when relevant: DESIGN-01, CODE-01, QA-01, SEC-01, PERF-01, SEO-01, OPS-01, TB-01.',
    'If a decision materially changes product behavior, privacy, data handling, production architecture, irreversible behavior, or cost, put it in decisions_required.',
    'Do not edit source, test, deploy, approve quality, spend money, or claim implementation.',
    'Return only structured JSON matching the schema.'
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
          model,stream:false,format:IDEA_SCHEMA,
          options:{temperature:0.15,num_predict:1800},
          messages:[
            {role:'system',content:system},
            {role:'user',content:JSON.stringify({task,authorized_context:context})}
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
  throw new Error('IDEA-01 model failed after at most two attempts: '+(lastError?.message||String(lastError)));
}

function taskById(s,taskId){
  const t=s.tasks.find(x=>x.task_id===taskId);
  if(!t) throw new Error('Task not found: '+taskId);
  return t;
}

export async function runIdeaBrain(inputState,{taskId,fetchImpl=fetch,url=DEFAULT_URL,model=DEFAULT_MODEL}={}){
  const s=ensureArrays(clone(inputState));
  const task=taskById(s,taskId);
  if(task.assigned_to!=='IDEA-01') throw new Error('IDEA-01 cannot process task assigned to '+task.assigned_to);
  if(task.created_by!=='ATLAS') throw new Error('IDEA-01 tasks must be assigned by ATLAS');
  if(['READY_FOR_CEO_REVIEW','NEEDS_DECISION'].includes(task.status)&&task.outputs?.idea_brief){
    return {state:s,brief:task.outputs.idea_brief,reused:true};
  }

  task.status='ANALYZING';
  task.updated_at=now();
  const context=task.inputs?.project_context||task.inputs?.context||{};
  const {parsed,model:usedModel,attempt}=await ask({
    task:{
      task_id:task.task_id,
      project:task.project,
      objective:task.objective,
      scope:task.scope,
      acceptance_criteria:task.acceptance_criteria,
      constraints:task.inputs?.constraints||[]
    },
    context,fetchImpl,url,model
  });
  const briefData=validateIdeaBrief(parsed);
  const brief={
    evidence_id:uid('EVD'),
    agent_id:'IDEA-01',
    task_id:task.task_id,
    at:now(),
    type:'PRODUCT_BRIEF',
    ...briefData,
    model:usedModel,
    model_attempt:attempt,
    claims_execution_performed:false
  };

  task.outputs=task.outputs||{};
  task.outputs.idea_brief=brief;
  task.evidence=Array.isArray(task.evidence)?task.evidence:[];
  task.evidence.push(brief);
  task.status=brief.status;
  task.updated_at=now();

  message(s,{
    task_id:task.task_id,
    from:'IDEA-01',
    to:'ATLAS',
    type:brief.status==='NEEDS_DECISION'?'IDEA_DECISION_REQUIRED':'IDEA_BRIEF_READY',
    payload:{
      status:brief.status,
      summary:brief.summary,
      recommended_assignees:brief.recommended_assignees,
      decisions_required:brief.decisions_required
    }
  });
  audit(s,{
    actor:'IDEA-01',
    action:brief.status==='NEEDS_DECISION'?'IDEA_ESCALATED':'IDEA_BRIEF_SUBMITTED',
    task_id:task.task_id,
    target:'ATLAS',
    result:brief.status,
    model:usedModel
  });
  s.updated_at=now();
  return {state:s,brief,reused:false};
}

export function ideaSummary(state,taskId){
  const task=(state.tasks||[]).find(t=>t.task_id===taskId);
  if(!task) return {task_id:taskId,status:'NOT_FOUND'};
  return {
    task_id:taskId,
    assigned_to:task.assigned_to,
    status:task.status,
    idea_brief:task.outputs?.idea_brief||null,
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
  if(!statePath||!taskId) throw new Error('Usage: node idea-01-brain.mjs <run|summary> --state <file> --task-id <id> [--output <file>]');
  const current=JSON.parse(fs.readFileSync(statePath,'utf8'));
  if(cmd==='run'){
    const out=await runIdeaBrain(current,{taskId});
    fs.writeFileSync(statePath,JSON.stringify(out.state,null,2)+'\n');
    if(output) fs.writeFileSync(output,JSON.stringify(out.brief,null,2)+'\n');
    else console.log(JSON.stringify(out.brief,null,2));
  }else if(cmd==='summary'){
    const out=ideaSummary(current,taskId);
    if(output) fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n');
    else console.log(JSON.stringify(out,null,2));
  }else throw new Error('Unknown command: '+cmd);
}
