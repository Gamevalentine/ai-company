import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AionPlatform } from './runtime.mjs';
import { normalizeExecutorEvidence, collectExecutorEvidence } from './github-executor-collector.mjs';

test('collector normalizes successful executor run with jobs and artifacts',()=>{
  const out=normalizeExecutorEvidence(
    {id:123,html_url:'https://example/run/123',status:'completed',conclusion:'success',head_sha:'abc',head_branch:'main',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:01:00Z'},
    [{id:1,name:'Safety gate',status:'completed',conclusion:'success'},{id:2,name:'Validate AION sandbox',status:'completed',conclusion:'success'}],
    [{id:9,name:'aion-executor-result-123',expired:false,size_in_bytes:456}]
  );
  assert.equal(out.result,'PASS');
  assert.equal(out.evidence.run_id,'123');
  assert.equal(out.evidence.jobs.length,2);
  assert.equal(out.evidence.artifacts[0].name,'aion-executor-result-123');
});

test('collector rejects incomplete run',async()=>{
  const responses=[
    {ok:true,status:200,json:async()=>({id:123,status:'in_progress',conclusion:null}),text:async()=>''},
    {ok:true,status:200,json:async()=>({jobs:[]}),text:async()=>''},
    {ok:true,status:200,json:async()=>({artifacts:[]}),text:async()=>''}
  ];
  let i=0;
  const fetchImpl=async()=>responses[i++];
  await assert.rejects(
    collectExecutorEvidence({token:'x',runId:'123',fetchImpl}),
    /not completed/
  );
});

test('runtime returns executor result to DEV inbox and task store',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aion-collector-'));
  const p=new AionPlatform({dataDir:dir});
  const root=p.createTask('ATLAS',{assigned_to:'TB-01',project:'TrainingBot',objective:'pilot'});
  const dev=p.createSubtask('TB-01',root.task_id,{assigned_to:'DEV-TB-01',objective:'build sandbox'});
  const ex=p.requestExecution('DEV-TB-01',dev.task_id,{operation:'sandbox_build',target_branch:'aion-sandbox'});
  p.completeExecution(ex.execution_id,{result:'PASS',evidence:{run_id:'123',run_url:'https://example/run/123'}});
  const task=p.task(dev.task_id);
  assert.equal(task.status,'EXECUTION_PASSED');
  assert.equal(task.outputs.execution.result,'PASS');
  const msg=p.inbox('DEV-TB-01').find(x=>x.type==='EXECUTION_RESULT'&&x.task_id===dev.task_id);
  assert.ok(msg);
  assert.equal(msg.payload.result,'PASS');
});
