import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPilot } from './code-01/pilot.mjs';

test('pilot reproduces a real bug, records real retests and never labels replay as live acceptance',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'code-pilot-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const outputDir=path.join(root,'output');
  const report=await runPilot({mode:'replay',workDir:path.join(root,'work'),outputDir});
  assert.equal(report.baseline.exit_code,1);
  assert.equal((report.baseline.output.match(/FAIL:/g)||[]).length,2);
  assert.equal(report.execution.checks.at(-1).exit_code,0);
  assert.equal(report.qa.checks[0].exit_code,0);
  assert.notEqual(report.qa.workspace,report.execution.workspace);
  assert.equal(report.status,'COMPLETED');
  assert.equal(report.original_source_unchanged,true);
  assert.equal(report.live_acceptance,false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir,'code01-replay.json'),'utf8')).live_acceptance,false);
  assert.match(fs.readFileSync(path.join(outputDir,'code01-replay.patch'),'utf8'),/\+exports.*priceCents \* item.quantity/);
});
