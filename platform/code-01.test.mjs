import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { runCodeTask } from './code-01/brain.mjs';

function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'code01-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const p=new AionPlatform({dataDir:dir});
  const task=p.createTask('ATLAS',{assigned_to:'CODE-01',project:'AION-HQ',objective:'Fix a missing label',inputs:{source_context:[{path:'index.html',content:'<button></button>'}]}});
  return {p,task,dir};
}
const plan=()=>({summary:'Propose a button label',steps:['Inspect the button'],proposed_changes:[{path:'index.html',description:'Add a label'}],verification_plan:['Check accessible name'],missing_context:[]});
const reply=value=>({ok:true,json:async()=>({message:{content:JSON.stringify(value)}})});

test('CODE-01 loads its real prompt, sends context, persists a proposal and reports to CEO',async t=>{
  const {p,task,dir}=setup(t);
  await runCodeTask(p,task.task_id,{fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);
    assert.match(body.messages[0].content,/Independent AI Software Engineer/);
    assert.match(body.messages[0].content,/PLANNING ONLY/);
    assert.match(body.messages[1].content,/<button>/);
    return reply(plan());
  }});
  const saved=new AionPlatform({dataDir:dir}).task(task.task_id);
  assert.equal(saved.status,'PLAN_READY');
  assert.equal(saved.outputs.code_plan.execution_performed,false);
  assert.equal(saved.evidence.length,0);
  assert.equal(p.inbox('ATLAS').at(-1).type,'CODE_PLAN_READY');
  await assert.rejects(runCodeTask(p,task.task_id),/already running or has a result/);
});

test('CODE-01 waits for missing context instead of claiming completion',async t=>{
  const {p,task}=setup(t);
  await runCodeTask(p,task.task_id,{fetchImpl:async()=>reply({...plan(),missing_context:['Need the expected label']})});
  assert.equal(p.task(task.task_id).status,'WAITING_CONTEXT');
});

test('CODE-01 rejects wrong assignee before contacting model',async t=>{
  const {p}=setup(t);
  const task=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot'});
  await assert.rejects(runCodeTask(p,task.task_id,{fetchImpl:()=>assert.fail('must not call model')}),/assigned by ATLAS/);
});

test('CODE-01 retries malformed output and rejects fabricated execution fields',async t=>{
  const {p,task}=setup(t);
  let calls=0;
  await assert.rejects(runCodeTask(p,task.task_id,{fetchImpl:async()=>{calls++;return reply({...plan(),status:'COMPLETED'});}}),/model failed/);
  assert.equal(calls,2);
  assert.equal(p.task(task.task_id).status,'AI_FAILED');
  assert.equal(p.task(task.task_id).outputs.code_plan,undefined);
  await runCodeTask(p,task.task_id,{fetchImpl:async()=>reply(plan())});
  assert.equal(p.task(task.task_id).status,'PLAN_READY');
});

test('CODE-01 rejects path traversal and remote model endpoints',async t=>{
  const {p,task}=setup(t);
  await assert.rejects(runCodeTask(p,task.task_id,{url:'https://example.com',fetchImpl:()=>assert.fail('no network')}),/local Ollama/);
  await assert.rejects(runCodeTask(p,task.task_id,{fetchImpl:async()=>reply({...plan(),proposed_changes:[{path:'../secret',description:'bad'}]})}),/model failed/);
});

test('CODE-01 bounds stalled requests and records failure without response secrets',async t=>{
  const {p,task}=setup(t);
  let calls=0;
  const fetchImpl=(_url,{signal})=>new Promise((resolve,reject)=>{
    calls++;
    signal.addEventListener('abort',()=>reject(new Error('sensitive provider response')),{once:true});
  });
  await assert.rejects(runCodeTask(p,task.task_id,{fetchImpl,timeoutMs:5}),/model failed/);
  assert.equal(calls,2);
  assert.equal(p.task(task.task_id).status,'AI_FAILED');
  assert.doesNotMatch(JSON.stringify(p.store.audits()),/sensitive provider/);
});
