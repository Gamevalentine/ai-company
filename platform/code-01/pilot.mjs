import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AionPlatform } from '../runtime.mjs';
import { createWorkspace,runProcess } from './tools.mjs';
import { runCodeCycle } from './review.mjs';

const BROKEN='exports.totalCents = items => items.reduce((sum, item) => sum + item.priceCents + item.quantity, 0);\n';
const FIXED='exports.totalCents = items => items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);\n';
const TEST=`const assert = require('node:assert/strict');
const { totalCents } = require('./cart.cjs');
let failures = 0;
for (const [name, items, expected] of [
  ['empty cart', [], 0],
  ['multiple quantities', [{priceCents: 1200, quantity: 3}], 3600],
  ['multiple products', [{priceCents: 1200, quantity: 2}, {priceCents: 500, quantity: 4}], 4400]
]) {
  try { assert.equal(totalCents(items), expected); console.log('PASS: '+name); }
  catch (error) { failures++; console.error('FAIL: '+name+' — '+error.message); }
}
process.exitCode = failures ? 1 : 0;
`;

// Only for this closed, fixed fixture. Never use this adapter for model-written code.
async function fixtureProcess(_binary,args){
  if(args[0]==='rm') return {exit_code:0,output:'No container in fixture replay',timed_out:false};
  if(args[0]!=='run'||args.at(-1)!=='check.cjs') throw new Error('Unexpected fixture command');
  const mount=args[args.indexOf('--mount')+1];
  const root=mount?.match(/^type=bind,source=(.*),target=\/workspace,readonly$/)?.[1];
  if(!root) throw new Error('Invalid fixture workspace');
  if(fs.readFileSync(path.join(root,'check.cjs'),'utf8')!==TEST||![BROKEN,FIXED].includes(fs.readFileSync(path.join(root,'cart.cjs'),'utf8'))) throw new Error('Host replay accepts only the exact known fixture, never arbitrary code');
  return runProcess(process.execPath,[path.join(root,'check.cjs')]);
}

export async function runPilot({mode='live',workDir,outputDir,image='node:24-alpine'}={}){
  if(!['live','replay'].includes(mode)||!path.isAbsolute(workDir)||!path.isAbsolute(outputDir)) throw new Error('Use live|replay and absolute work/output directories');
  fs.mkdirSync(workDir,{recursive:true});fs.mkdirSync(outputDir,{recursive:true});
  const runDir=fs.mkdtempSync(path.join(workDir,'code01-pilot-'));
  const repo=path.join(runDir,'source');fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo,'cart.cjs'),BROKEN);fs.writeFileSync(path.join(repo,'check.cjs'),TEST);
  const platform=new AionPlatform({dataDir:path.join(runDir,'state')});
  const criteria=['Empty cart returns zero','Quantity multiplies price','Multiple products are summed correctly'];
  const task=platform.createTask('ATLAS',{assigned_to:'CODE-01',project:'AION-HQ',objective:'Fix totalCents in cart.cjs: quantity must multiply priceCents, then sum the lines. Run the provided check. Do not edit check.cjs.',scope:'cart.cjs only; disposable pilot',acceptance_criteria:criteria});
  const grant={task_id:task.task_id,project:'AION-HQ',repo_root:repo,workspace_root:path.join(runDir,'workspaces'),files:['cart.cjs','check.cjs'],editable:['cart.cjs'],image,commands:[{id:'acceptance',argv:['node','check.cjs']}],acceptance_checks:Object.fromEntries(criteria.map(c=>[c,['acceptance']]))};
  fs.writeFileSync(path.join(runDir,'grant.json'),JSON.stringify(grant,null,2));
  let step=0;
  const actions=[{tool:'read_file',path:'cart.cjs'},{tool:'read_file',path:'check.cjs'},{tool:'run_check',command_id:'acceptance'},{tool:'write_file',path:'cart.cjs',content:FIXED},{tool:'run_check',command_id:'acceptance'},{tool:'diff'},{tool:'finish'}];
  const options=mode==='replay'?{
    model:'SCRIPTED_FIXTURE_REPLAY_NOT_LLM',processRunner:fixtureProcess,
    fetchImpl:async()=>({ok:true,json:async()=>({message:{content:JSON.stringify(actions[step++])}})})
  }:{};
  const baselineWorkspace=createWorkspace(grant,task);
  const baseline=await baselineWorkspace.check('acceptance',{processRunner:options.processRunner});
  let failure=null;
  if(baseline.exit_code!==1||!baseline.output.includes('FAIL: multiple quantities')) failure='Baseline did not reproduce the intended bug; environment may be unavailable';
  else{
    try{
      await runCodeCycle(platform,task.task_id,grant,options);
      if(platform.task(task.task_id).status==='READY_FOR_CEO_REVIEW') platform.ceoReview('ATLAS',task.task_id);
    }catch(error){failure=error.message;}
  }
  const final=platform.task(task.task_id),execution=final.outputs.code_execution,qa=final.outputs.code_qa;
  const verified=final.status==='COMPLETED'&&qa?.result==='PASS'&&execution?.changes.length===1&&execution.changes[0].path==='cart.cjs';
  const report={mode,requested_live_model:mode==='live',requested_docker:mode==='live',verified:!!verified,live_acceptance:mode==='live'&&!!verified,failure,task_id:task.task_id,status:final.status,run_directory:runDir,baseline,execution,qa,audit:platform.timeline(task.task_id),original_source_unchanged:fs.readFileSync(path.join(repo,'cart.cjs'),'utf8')===BROKEN,created_at:new Date().toISOString()};
  const prefix='code01-'+mode;
  fs.writeFileSync(path.join(outputDir,prefix+'.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(outputDir,prefix+'-before.log'),baseline.output);
  if(execution?.changes.length){
    const change=execution.changes[0];
    const patch='--- a/cart.cjs\n+++ b/cart.cjs\n@@ -1 +1 @@\n-'+change.before.trimEnd()+'\n+'+change.after.trimEnd()+'\n';
    fs.writeFileSync(path.join(outputDir,prefix+'.patch'),patch);
    fs.writeFileSync(path.join(outputDir,prefix+'-after.log'),execution.checks.at(-1)?.output||'');
    fs.writeFileSync(path.join(outputDir,prefix+'-qa.log'),qa?.checks.map(c=>c.output).join('\n')||'');
  }
  const md=`# CODE-01: kiểm chứng sửa lỗi giỏ hàng\n\nChế độ: **${mode}**. Trạng thái: **${final.status}**.\n\n`+
    (mode==='replay'?'Model được mô phỏng bằng chuỗi thao tác cố định. File thật được sửa và kiểm thử bằng Node thật với fixture đã kiểm soát; không chạy Docker. Kết quả này không chứng minh khả năng tự lập trình của model hay cách ly container.\n\n':'Yêu cầu chạy model Ollama và Docker thật; kết quả chỉ đạt khi toàn bộ luồng hoàn tất.\n\n')+
    `- Bài toán: sửa phép tính giá × số lượng trong tổng giỏ hàng.\n- Baseline exit code: ${baseline.exit_code}.\n- Test sau sửa: ${execution?.checks.at(-1)?.exit_code??'chưa chạy'}.\n- QA độc lập: ${qa?.result??'chưa chạy'}.\n- Repo nguồn giữ nguyên: ${report.original_source_unchanged}.\n- Nghiệm thu model + Docker thật: ${report.live_acceptance?'ĐẠT':'CHƯA ĐẠT'}.\n`+
    (failure?`\nLý do dừng: ${failure}.\n`:'')+
    `\nTask: ${task.task_id}. Bằng chứng đầy đủ: ${prefix}.json; diff và log đi kèm nếu đã thực hiện.\n`;
  fs.writeFileSync(path.join(outputDir,prefix+'.md'),md);
  return report;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [mode,workDir,outputDir]=process.argv.slice(2);
  const report=await runPilot({mode,workDir,outputDir,image:process.env.CODE01_TEST_IMAGE||'node:24-alpine'});
  console.log(JSON.stringify({mode:report.mode,verified:report.verified,live_acceptance:report.live_acceptance,status:report.status,failure:report.failure}));
  if(!report.verified) process.exitCode=1;
}
