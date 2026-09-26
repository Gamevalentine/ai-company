import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWED_PROJECT='TrainingBot';
const ALLOWED_AUTHOR='Gamevalentine';

function cleanText(value,max=2000){
  if(typeof value!=='string') return '';
  return value.trim().slice(0,max);
}

export function parseAtlasIssue({body,issueNumber,author}){
  if(author!==ALLOWED_AUTHOR) throw new Error('ATLAS bridge denied: untrusted issue author');
  let input;
  try{ input=JSON.parse(body); }catch{ throw new Error('ATLAS bridge requires a JSON issue body'); }

  const objective=cleanText(input.objective,1800);
  if(objective.length<5) throw new Error('objective is required');
  const project=cleanText(input.project,100)||ALLOWED_PROJECT;
  if(project!==ALLOWED_PROJECT) throw new Error('Only TrainingBot is enabled for the pilot bridge');

  const executionMode=cleanText(input.execution_mode,60)||'sandbox-only';
  if(executionMode!=='sandbox-only') throw new Error('Only sandbox-only execution is allowed');

  const scope=cleanText(input.scope,1200)||'TrainingBot aion-sandbox only';
  const acceptance=Array.isArray(input.acceptance_criteria)
    ? input.acceptance_criteria.map(x=>cleanText(x,300)).filter(Boolean).slice(0,10)
    : [];
  if(acceptance.length===0) throw new Error('acceptance_criteria must contain at least one item');

  const risk=(cleanText(input.risk_level,20)||'low').toLowerCase();
  if(!['low','medium'].includes(risk)) throw new Error('High-risk tasks are not accepted by the pilot bridge');

  const taskId='ATLAS-ISSUE-'+String(issueNumber);
  return {
    task_id:taskId,
    actor_id:'ATLAS',
    assigned_to:'TB-01',
    project:ALLOWED_PROJECT,
    objective,
    scope,
    acceptance_criteria:acceptance,
    risk_level:risk,
    inputs:{
      source:'github-issue',
      source_issue_number:Number(issueNumber),
      execution_mode:'sandbox-only',
      owner_approval_required_for_production:true
    }
  };
}

export function resultMarkdown(summary,{issueNumber}={}){
  const status=summary?.status||'UNKNOWN';
  const children=Array.isArray(summary?.children)?summary.children:[];
  const dev=children.filter(x=>x.assigned_to==='DEV-TB-01').at(-1);
  const qa=children.filter(x=>x.assigned_to==='QA-TB-01').at(-1);
  const report=summary?.manager_summary||{};
  const qaReason=report?.qa_report?.model_reason||report?.qa_reason||'';
  const machine={
    protocol:'AION_ATLAS_BRIDGE_V1',
    issue_number:Number(issueNumber),
    task_id:summary?.task_id||null,
    status,
    dev_task_id:dev?.task_id||report?.dev_task_id||null,
    dev_status:dev?.status||null,
    qa_task_id:qa?.task_id||report?.qa_task_id||null,
    qa_status:qa?.status||null,
    manager_status:report?.status||null
  };
  return [
    '## AION Runtime result',
    '',
    '- Task: '+(machine.task_id||'unknown'),
    '- Status: **'+status+'**',
    '- DEV: '+(machine.dev_task_id?(machine.dev_task_id+' -> **'+(machine.dev_status||'UNKNOWN')+'**'):'not created'),
    '- QA: '+(machine.qa_task_id?(machine.qa_task_id+' -> **'+(machine.qa_status||'UNKNOWN')+'**'):'not created'),
    qaReason?'- QA note: '+qaReason.slice(0,500):'',
    '',
    status==='READY_FOR_CEO_REVIEW'
      ? 'Kết quả đã quay về tầng CEO để ATLAS nghiệm thu. Production vẫn bị khóa.'
      : 'Task chưa đủ điều kiện trình ATLAS nghiệm thu. Production vẫn bị khóa.',
    '',
    '<!-- AION_RESULT '+JSON.stringify(machine)+' -->'
  ].filter(Boolean).join('\n');
}

function arg(name){
  const i=process.argv.indexOf(name);
  return i>=0?process.argv[i+1]:null;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const cmd=process.argv[2];
  if(cmd==='parse'){
    const bodyFile=arg('--body-file');
    const output=arg('--output');
    const issueNumber=arg('--issue-number');
    const author=arg('--author');
    if(!bodyFile||!output||!issueNumber||!author) throw new Error('Missing parse arguments');
    const payload=parseAtlasIssue({body:fs.readFileSync(bodyFile,'utf8'),issueNumber,author});
    fs.writeFileSync(output,JSON.stringify(payload,null,2)+'\n');
    console.log(JSON.stringify({ok:true,task_id:payload.task_id,project:payload.project}));
  } else if(cmd==='render'){
    const summaryFile=arg('--summary-file');
    const output=arg('--output');
    const issueNumber=arg('--issue-number');
    if(!summaryFile||!output||!issueNumber) throw new Error('Missing render arguments');
    const summary=JSON.parse(fs.readFileSync(summaryFile,'utf8'));
    fs.writeFileSync(output,resultMarkdown(summary,{issueNumber})+'\n');
  } else {
    throw new Error('Unknown command: '+cmd);
  }
}
