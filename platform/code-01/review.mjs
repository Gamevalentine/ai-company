import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AionPlatform } from '../runtime.mjs';
import { createWorkspace,grantDigest,snapshotManifest } from './tools.mjs';
import { executeCodeTask } from './execute.mjs';

export async function reviewCodeTask(platform,taskId,grant,{actor='QA-01',processRunner}={}){
  const task=platform.task(taskId),agent=platform.agent(actor),execution=task.outputs?.code_execution;
  if(actor!=='QA-01'||agent.role!=='qa'||!agent.allowed_tools.includes('code01_qa_checks')) throw new Error('Independent QA-01 required');
  platform.assertProject(agent,task.project);platform.assertPermission(actor,'run_qa');
  if(task.assigned_to!=='CODE-01'||task.status!=='WAITING_QA'||execution?.status!=='WAITING_QA') throw new Error('Current CODE execution must be waiting for QA');
  if(execution.grant_digest!==grantDigest(grant)) throw new Error('QA grant differs from execution grant');
  const qa=platform.createTask('ATLAS',{assigned_to:actor,project:task.project,parent_task_id:taskId,objective:'Independently retest CODE-01 execution '+execution.execution_id,acceptance_criteria:task.acceptance_criteria,inputs:{code_execution_id:execution.execution_id}});
  platform.acceptTask(actor,qa.task_id);
  platform.store.mutate(s=>{s.tasks.find(t=>t.task_id===taskId).status='QA_RUNNING';});
  const report={qa_task_id:qa.task_id,execution_id:execution.execution_id,acceptance_criteria:task.acceptance_criteria,result:'FAIL',checks:[],manifest:execution.manifest,findings:[],created_at:new Date().toISOString()};
  try{
    const equalManifest=()=>JSON.stringify(snapshotManifest(execution.workspace,execution.files))===JSON.stringify(execution.manifest);
    if(!equalManifest()) throw new Error('CODE workspace differs from submitted evidence');
    const criteria=task.acceptance_criteria;
    if(!Array.isArray(criteria)||!criteria.length||criteria.some(c=>typeof c!=='string'||!c.trim())) throw new Error('Explicit acceptance criteria required');
    const ids=grant.commands.map(c=>c.id);
    for(const criterion of criteria){
      const mapped=Object.hasOwn(grant.acceptance_checks||{},criterion)&&grant.acceptance_checks[criterion];
      if(!Array.isArray(mapped)||!mapped.length||mapped.some(id=>!ids.includes(id))) throw new Error('Missing approved check mapping for: '+criterion);
    }
    // QA gets a separate immutable copy and no editing tool.
    const workspace=createWorkspace({...grant,repo_root:execution.workspace,workspace_root:path.join(grant.workspace_root,'qa'),editable:[]},task);
    if(JSON.stringify(workspace.manifest())!==JSON.stringify(execution.manifest)) throw new Error('QA copy does not match submitted revision');
    report.workspace=workspace.root;
    for(const id of workspace.commands.keys()) report.checks.push(await workspace.check(id,{processRunner}));
    if(!equalManifest()||JSON.stringify(workspace.manifest())!==JSON.stringify(execution.manifest)) throw new Error('Workspace changed during QA');
    if(!workspace.verified()) throw new Error('Independent acceptance checks failed');
    report.result='PASS';
  }catch(error){report.findings.push(error.message);}
  const exhausted=(task.outputs.code_attempts||[]).length>=3;
  const status=report.result==='PASS'?'READY_FOR_CEO_REVIEW':exhausted?'REWORK_LIMIT_REACHED':'NEEDS_REWORK';
  platform.store.mutate(s=>{
    const child=s.tasks.find(t=>t.task_id===qa.task_id),root=s.tasks.find(t=>t.task_id===taskId);
    child.status='QA_'+report.result;child.outputs.code_qa=report;child.evidence.push({type:'INDEPENDENT_CODE_QA',...report});child.updated_at=report.created_at;
    root.status=status;root.outputs.code_qa=report;root.updated_at=report.created_at;
  });
  platform.sendMessage(actor,'ATLAS',qa.task_id,'CODE_QA_RESULT',report);
  if(report.result==='FAIL') platform.sendMessage('ATLAS','CODE-01',taskId,'CODE_REWORK_REQUIRED',{execution_id:execution.execution_id,findings:report.findings,checks:report.checks,retry_allowed:!exhausted});
  platform.store.audit({actor,action:'INDEPENDENT_CODE_QA',task_id:taskId,result:report.result,execution_id:execution.execution_id});
  return report;
}

export async function runCodeCycle(platform,taskId,grant,options={}){
  // The CEO explicitly invokes this bounded cycle; it does not auto-approve work.
  while(true){
    const task=platform.task(taskId);
    if(['READY_FOR_CEO_REVIEW','REWORK_LIMIT_REACHED','CODE_BLOCKED'].includes(task.status)) return task;
    if(task.status!=='WAITING_QA'){
      const result=await executeCodeTask(platform,taskId,grant,options);
      if(result.status!=='WAITING_QA') return platform.task(taskId);
    }
    await reviewCodeTask(platform,taskId,grant,{processRunner:options.processRunner});
  }
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [command,taskId,configPath]=process.argv.slice(2);
  if(!process.env.AION_DATA_DIR||!taskId) throw new Error('Set AION_DATA_DIR; use review.mjs qa|cycle TASK_ID GRANT.json or ceo TASK_ID [--production]');
  const platform=new AionPlatform({dataDir:process.env.AION_DATA_DIR});
  if(command==='ceo') platform.ceoReview('ATLAS',taskId,{requiresProduction:configPath==='--production'});
  else{
    const grant=JSON.parse(fs.readFileSync(configPath,'utf8'));
    if(command==='qa') await reviewCodeTask(platform,taskId,grant);
    else if(command==='cycle') await runCodeCycle(platform,taskId,grant);
    else throw new Error('Unknown review command');
  }
  const status=platform.task(taskId).status;
  console.log(JSON.stringify({task_id:taskId,status}));
  if(!['READY_FOR_CEO_REVIEW','COMPLETED','WAITING_OWNER_APPROVAL'].includes(status)) process.exitCode=1;
}
