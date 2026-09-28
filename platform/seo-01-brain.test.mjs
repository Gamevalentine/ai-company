import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { hardSeoChecks, enforceSeoVerdict, runSeoBrain } from './seo-01-brain.mjs';

function fakeFetch(reply){
  return async()=>({
    ok:true,
    json:async()=>({model:'seo-test-model',message:{content:JSON.stringify(reply)}}),
    text:async()=>''
  });
}
function evidence(overrides={}){
  return {
    target_public:true,
    pages:[
      {
        url:'https://example.test/',
        title:'Example',
        meta_description:'Example page description',
        canonical:'https://example.test/',
        robots:'index,follow',
        h1_count:1,
        schema_types:['WebSite'],
        status_code:200
      }
    ],
    robots_txt:{blocked_target:false},
    sitemap:{available:true,valid:true},
    search_console:{available:false},
    serp:{available:false},
    changes:{implemented:false,verified:false,deployed:false,live_verified:false},
    ...overrides
  };
}
function reply(overrides={}){
  return {
    status:'READY_FOR_CEO_REVIEW',
    summary:'The supplied evidence shows no critical crawl or index blocker on the target page.',
    target:'Review technical and on-page SEO for the assigned page.',
    findings:[
      {severity:'info',area:'technical',finding:'Target page is indexable in supplied HTML evidence.',evidence:'robots=index,follow and HTTP 200'}
    ],
    recommendations:['Preserve current canonical and indexability settings.'],
    verification_plan:['Re-check metadata after any source change.'],
    evidence_gaps:['No Search Console data was supplied, so indexing and traffic performance are not verified.'],
    recommended_next_role:'NONE',
    owner_decision_required:false,
    owner_decision_reason:'',
    ...overrides
  };
}
function stateFor({seoEvidence=evidence(),assigned_to='SEO-01',created_by='ATLAS'}={}){
  return {
    tasks:[{
      task_id:'SEO-TASK-001',
      project:'AION-HQ',
      created_by,
      assigned_to,
      objective:'Audit SEO',
      scope:'Evidence-based SEO audit only',
      acceptance_criteria:['Return evidence-based findings'],
      status:'QUEUED',
      inputs:{seo_evidence:seoEvidence},
      outputs:{},
      evidence:[]
    }],
    messages:[],memories:[],executions:[],audit:[]
  };
}

test('SEO-01 is a direct ATLAS report',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aion-seo-'));
  const p=new AionPlatform({dataDir:dir});
  const seo=p.agent('SEO-01');
  assert.equal(seo.reports_to,'ATLAS');
  assert.ok(p.agent('ATLAS').can_assign_to.includes('SEO-01'));
  assert.ok(seo.prohibited_actions.includes('publish_unapproved_content'));
  assert.ok(seo.prohibited_actions.includes('manipulative_link_spam'));
});

test('SEO-01 produces traceable handoff to ATLAS',async()=>{
  const out=await runSeoBrain(stateFor(),{
    taskId:'SEO-TASK-001',
    fetchImpl:fakeFetch(reply())
  });
  const task=out.state.tasks[0];
  assert.equal(task.status,'READY_FOR_CEO_REVIEW');
  assert.equal(task.outputs.seo_handoff.agent_id,'SEO-01');
  assert.equal(task.outputs.seo_handoff.model,'seo-test-model');
  assert.equal(task.outputs.seo_handoff.claims_direct_web_or_search_console_access,false);
  assert.ok(task.evidence.some(e=>e.type==='SEO_HANDOFF'));
  assert.ok(out.state.messages.some(m=>m.from==='SEO-01'&&m.to==='ATLAS'&&m.type==='SEO_HANDOFF_READY'));
});

test('robots block forces NEEDS_ATTENTION',async()=>{
  const e=evidence({robots_txt:{blocked_target:true}});
  const out=await runSeoBrain(stateFor({seoEvidence:e}),{
    taskId:'SEO-TASK-001',
    fetchImpl:fakeFetch(reply())
  });
  assert.equal(out.report.status,'NEEDS_ATTENTION');
  assert.ok(out.report.hard_checks.critical.length>0);
});

test('noindex on public target forces NEEDS_ATTENTION',()=>{
  const e=evidence();
  e.pages[0].robots='noindex,follow';
  const checks=hardSeoChecks(e);
  const gate=enforceSeoVerdict(reply(),checks);
  assert.equal(gate.status,'NEEDS_ATTENTION');
});

test('unverified indexing claim forces NEEDS_EVIDENCE',()=>{
  const model=reply({
    summary:'Google indexed the page successfully and indexing improved.'
  });
  const gate=enforceSeoVerdict(model,hardSeoChecks(evidence()));
  assert.equal(gate.status,'NEEDS_EVIDENCE');
  assert.equal(gate.overridden,true);
});

test('unverified ranking or traffic claim forces NEEDS_EVIDENCE',()=>{
  const model=reply({
    summary:'Organic ranking improved and traffic increased after the change.'
  });
  const gate=enforceSeoVerdict(model,hardSeoChecks(evidence()));
  assert.equal(gate.status,'NEEDS_EVIDENCE');
});

test('unverified implementation claim forces NEEDS_EVIDENCE',()=>{
  const model=reply({
    summary:'The canonical issue was fixed and deployed live.',
    recommended_next_role:'CODE-01'
  });
  const gate=enforceSeoVerdict(model,hardSeoChecks(evidence()));
  assert.equal(gate.status,'NEEDS_EVIDENCE');
});

test('SEO-01 rejects wrong assignee before model call',async()=>{
  let called=0;
  await assert.rejects(
    ()=>runSeoBrain(stateFor({assigned_to:'CODE-01'}),{
      taskId:'SEO-TASK-001',
      fetchImpl:async()=>{called++;return fakeFetch(reply())();}
    }),
    /cannot process task assigned to CODE-01/
  );
  assert.equal(called,0);
});

test('SEO-01 rejects tasks not assigned by ATLAS',async()=>{
  await assert.rejects(
    ()=>runSeoBrain(stateFor({created_by:'OWNER'}),{
      taskId:'SEO-TASK-001',
      fetchImpl:fakeFetch(reply())
    }),
    /must be assigned by ATLAS/
  );
});

test('SEO-01 requires local model endpoint',async()=>{
  await assert.rejects(
    ()=>runSeoBrain(stateFor(),{
      taskId:'SEO-TASK-001',
      fetchImpl:fakeFetch(reply()),
      url:'https://example.com'
    }),
    /requires a local Ollama endpoint/
  );
});
