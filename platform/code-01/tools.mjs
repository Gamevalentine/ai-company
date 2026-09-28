import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const MAX_FILE=128*1024;
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
export const grantDigest=grant=>hash(JSON.stringify(grant));
export function snapshotManifest(root,files){
  root=fs.realpathSync(root);
  return files.map(name=>{const file=safePath(root,name,{missing:true});return {path:name,sha256:fs.existsSync(file)?hash(readText(file)):null};});
}
const inside=(root,target)=>{const rel=path.relative(root,target);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};

export function relativeFile(name){
  if(typeof name!=='string'||!name||name.length>240||name.includes('\\')||/[:\x00-\x1f]/.test(name)||name.startsWith('/')) throw new Error('Invalid relative file path');
  const parts=name.split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Invalid file component');
  if(parts.some(p=>/^\.git$/i.test(p)||/^\.env(?:\.|$)/i.test(p)||/\.(pem|key|p12|pfx)$/i.test(p))) throw new Error('Sensitive file denied');
  return name;
}

function safePath(root,name,{missing=false}={}){
  relativeFile(name);
  let current=root;
  for(const part of name.split('/')){
    current=path.join(current,part);
    if(!fs.existsSync(current)){
      if(missing) continue;
      throw new Error('File does not exist');
    }
    if(fs.lstatSync(current).isSymbolicLink()||!inside(root,fs.realpathSync(current))) throw new Error('Symlink or path escape denied');
  }
  return current;
}

function readText(file){
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>MAX_FILE) throw new Error('File is not a bounded text file');
  const bytes=fs.readFileSync(file);
  if(bytes.includes(0)) throw new Error('Binary files denied');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

function writeSnapshot(root,name,content){
  const file=safePath(root,name,{missing:true});
  let dir=root;
  for(const part of name.split('/').slice(0,-1)){
    dir=path.join(dir,part);fs.mkdirSync(dir,{recursive:true});fs.chmodSync(dir,0o755);
  }
  fs.writeFileSync(file,content);fs.chmodSync(file,0o644);
}

// Spawn only an operator-selected executable with argument arrays. Never use a shell.
export function runProcess(file,args,{timeoutMs=60000,maxOutput=16000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{shell:false,windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP}});
    let output='',timedOut=false,truncated=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
    const collect=data=>{const text=data.toString();truncated ||= output.length+text.length>maxOutput;output=(output+text).slice(0,maxOutput);};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);resolve({exit_code:code,output,timed_out:timedOut,truncated});});
  });
}

// Config is supplied by the operator, never by model output or task.inputs.
export function createWorkspace(config,task){
  if(config.task_id!==task.task_id||config.project!==task.project) throw new Error('Workspace grant does not match task/project');
  if(!path.isAbsolute(config.repo_root)||!path.isAbsolute(config.workspace_root)) throw new Error('Workspace roots must be absolute');
  const repo=fs.realpathSync(config.repo_root);
  fs.mkdirSync(config.workspace_root,{recursive:true});
  const workRoot=fs.realpathSync(config.workspace_root);
  if(workRoot.includes(',')) throw new Error('Workspace root cannot contain a comma');
  if(repo===workRoot||inside(repo,workRoot)||inside(workRoot,repo)) throw new Error('Workspace and source repository must be separate');
  if(!Array.isArray(config.files)||!config.files.length||config.files.length>100||!Array.isArray(config.editable)) throw new Error('Explicit files and editable grants required');
  const files=config.files.map(relativeFile),editable=config.editable.map(relativeFile);
  if(new Set(files.map(x=>x.toLowerCase())).size!==files.length||editable.some(x=>!files.includes(x))) throw new Error('Invalid or ambiguous file grant');
  if(!Array.isArray(config.commands)||!config.commands.length||config.commands.length>10) throw new Error('Approved checks required');
  const commands=new Map();
  for(const c of config.commands){
    if(!c||typeof c.id!=='string'||!/^[a-z0-9_-]+$/.test(c.id)||commands.has(c.id)||!Array.isArray(c.argv)||!c.argv.length||c.argv.some(v=>typeof v!=='string'||!v||v.includes('\0'))||c.argv[0].startsWith('-')) throw new Error('Invalid command grant');
    commands.set(c.id,[...c.argv]);
  }
  if(typeof config.image!=='string'||!/^[a-z0-9][a-z0-9./_:@-]+$/.test(config.image)) throw new Error('Explicit local container image required');
  const root=fs.mkdtempSync(path.join(workRoot,'code01-'));
  fs.chmodSync(root,0o755);
  const baseline=new Map();
  let total=0;
  for(const name of files){
    const src=safePath(repo,name,{missing:true});
    const content=fs.existsSync(src)?readText(src):null;
    if(content===null&&!editable.includes(name)) throw new Error('Read-only input missing');
    total+=content?.length||0;
    if(total>1024*1024) throw new Error('Workspace input exceeds 1 MiB');
    baseline.set(name,content);
    if(content!==null) writeSnapshot(root,name,content);
  }
  let revision=0;
  const checks=[];
  const changes=()=>files.flatMap(name=>{
    const file=safePath(root,name,{missing:true});
    const after=fs.existsSync(file)?readText(file):null,before=baseline.get(name);
    return before===after?[]:[{path:name,before,after,before_sha256:before===null?null:hash(before),after_sha256:after===null?null:hash(after)}];
  });
  return {
    root,files,editable,commands,checks,
    get revision(){return revision;},
    read(name){if(!files.includes(name)) throw new Error('Read outside grant denied');return readText(safePath(root,name));},
    write(name,content){
      if(!editable.includes(name)) throw new Error('Write outside grant denied');
      if(typeof content!=='string'||Buffer.byteLength(content)>MAX_FILE||content.includes('\0')) throw new Error('Invalid text content');
      writeSnapshot(root,name,content);revision++;
      return {path:name,sha256:hash(content),revision};
    },
    changes,
    manifest(){return snapshotManifest(root,files);},
    verified(){return [...commands.keys()].every(id=>{const last=checks.filter(c=>c.command_id===id).at(-1);return last?.revision===revision&&last.passed;});},
    async check(id,{processRunner=runProcess}={}){
      if(!commands.has(id)) throw new Error('Command outside grant denied');
      const name='code01-'+crypto.randomUUID();
      const timeout=Math.max(1000,Math.min(120000,Number(config.command_timeout_ms)||60000));
      // Read-only source mount: test code cannot modify tracked files or host state.
      const args=['run','--rm','--pull=never','--name',name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=512m','--cpus=1','--user=65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--mount',`type=bind,source=${root},target=/workspace,readonly`,'--workdir','/workspace','--entrypoint',commands.get(id)[0],config.image,...commands.get(id).slice(1)];
      let result;
      try{result=await processRunner(config.docker_binary||'docker',args,{timeoutMs:timeout});}
      catch{result={exit_code:null,output:'Container process unavailable',timed_out:false,truncated:false};}
      finally{
        // Docker client cancellation alone does not stop its container.
        await processRunner(config.docker_binary||'docker',['rm','-f',name],{timeoutMs:10000}).catch(()=>{});
      }
      const record={command_id:id,revision,argv:commands.get(id),...result,passed:result.exit_code===0&&!result.timed_out,at:new Date().toISOString()};
      checks.push(record);return record;
    }
  };
}
