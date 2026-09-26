const API='https://api.github.com';

async function api(path,{token,fetchImpl=fetch}={}){
  const res=await fetchImpl(API+path,{
    headers:{
      accept:'application/vnd.github+json',
      authorization:'Bearer '+token,
      'x-github-api-version':'2022-11-28'
    }
  });
  if(!res.ok) throw new Error('GitHub API '+res.status+': '+await res.text());
  return res.json();
}

export function normalizeExecutorEvidence(run,jobs=[],artifacts=[]){
  const result=run.conclusion==='success'?'PASS':'FAIL';
  return {
    result,
    evidence:{
      source:'github-actions',
      repository:'Gamevalentine/trainingbot-cloudflare',
      workflow:'aion-safe-executor.yml',
      run_id:String(run.id),
      run_url:run.html_url,
      run_status:run.status,
      conclusion:run.conclusion,
      head_sha:run.head_sha,
      head_branch:run.head_branch,
      created_at:run.created_at,
      updated_at:run.updated_at,
      jobs:jobs.map(j=>({
        id:String(j.id),
        name:j.name,
        status:j.status,
        conclusion:j.conclusion
      })),
      artifacts:artifacts.map(a=>({
        id:String(a.id),
        name:a.name,
        expired:Boolean(a.expired),
        size_in_bytes:a.size_in_bytes
      }))
    }
  };
}

export async function collectExecutorEvidence({token,runId,fetchImpl=fetch}){
  if(!token) throw new Error('GitHub token is required');
  if(!runId) throw new Error('runId is required');
  const [run,jobsData,artifactsData]=await Promise.all([
    api('/repos/Gamevalentine/trainingbot-cloudflare/actions/runs/'+runId,{token,fetchImpl}),
    api('/repos/Gamevalentine/trainingbot-cloudflare/actions/runs/'+runId+'/jobs',{token,fetchImpl}),
    api('/repos/Gamevalentine/trainingbot-cloudflare/actions/runs/'+runId+'/artifacts',{token,fetchImpl})
  ]);
  if(run.status!=='completed') throw new Error('Executor run is not completed');
  return normalizeExecutorEvidence(run,jobsData.jobs||[],artifactsData.artifacts||[]);
}

export async function collectAndApplyExecutorEvidence({platform,executionId,token,runId,fetchImpl=fetch}){
  const collected=await collectExecutorEvidence({token,runId,fetchImpl});
  const execution=platform.completeExecution(executionId,collected);
  return {execution,collected};
}
