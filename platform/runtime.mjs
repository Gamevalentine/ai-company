import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_AGENTS=JSON.parse(fs.readFileSync(path.join(__dirname,'agents.json'),'utf8'));
const PRODUCTION_OPS=new Set(['production_deploy','production_merge','dns_change','secret_change','delete_data']);

function now(){ return new Date().toISOString(); }
function id(prefix){ return prefix+'-'+crypto.randomUUID(); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }

export class PlatformError extends Error{
  constructor(code,message,status=400){ super(message); this.code=code; this.status=status; }
}

export class FileStore{
  constructor(dir){
    this.dir=dir;
    this.statePath=path.join(dir,'state.json');
    this.auditPath=path.join(dir,'audit.jsonl');
    fs.mkdirSync(dir,{recursive:true});
    if(!fs.existsSync(this.statePath)){
      this.write({agents:DEFAULT_AGENTS,tasks:[],messages:[],memories:[],executions:[],queue:[]});
    }
    if(!fs.existsSync(this.auditPath)) fs.writeFileSync(this.auditPath,'');
  }
  read(){ return JSON.parse(fs.readFileSync(this.statePath,'utf8')); }
  write(state){
    const tmp=this.statePath+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(state,null,2));
    fs.renameSync(tmp,this.statePath);
  }
  mutate(fn){
    const state=this.read();
    const result=fn(state);
    this.write(state);
    return result;
  }
  audit(event){
    fs.appendFileSync(this.auditPath,JSON.stringify({event_id:id('AUD'),at:now(),...event})+'\n');
  }
  audits(){
    return fs.readFileSync(this.auditPath,'utf8').split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
  }
}

export class AionPlatform{
  constructor({dataDir=path.join(__dirname,'data')}={}){
    this.store=new FileStore(dataDir);
  }
  state(){ return this.store.read(); }
  agent(agentId){
    const a=this.state().agents.find(x=>x.agent_id===agentId);
    if(!a) throw new PlatformError('AGENT_NOT_FOUND','Agent '+agentId+' không tồn tại',404);
    return a;
  }
  canAssign(from,to){ return this.agent(from).can_assign_to.includes(to); }
  assertProject(agent,project){
    if(!agent.project_scope.includes(project)) throw new PlatformError('PROJECT_DENIED',agent.agent_id+' không thuộc '+project,403);
  }
  assertPermission(agentId,permission){
    const a=this.agent(agentId);
    if(a.prohibited_actions.includes(permission)) throw new PlatformError('PROHIBITED',permission+' bị cấm với '+agentId,403);
    if(!a.permissions.includes(permission)) throw new PlatformError('PERMISSION_DENIED',agentId+' không có quyền '+permission,403);
  }
  createTask(actorId,input){
    const actor=this.agent(actorId);
    const assignee=this.agent(input.assigned_to);
    const project=input.project||'TrainingBot';
    this.assertProject(actor,project);
    this.assertProject(assignee,project);
    if(!this.canAssign(actorId,assignee.agent_id)) throw new PlatformError('REPORTING_CHAIN_DENIED',actorId+' không được giao trực tiếp cho '+assignee.agent_id,403);
    const task={
      task_id:input.task_id||id('TASK'),
      parent_task_id:input.parent_task_id||null,
      created_by:actorId,
      assigned_to:assignee.agent_id,
      project,
      objective:input.objective||'',
      scope:input.scope||'',
      acceptance_criteria:input.acceptance_criteria||[],
      risk_level:input.risk_level||'low',
      status:input.status||'QUEUED',
      inputs:input.inputs||{},
      outputs:{},
      evidence:[],
      approval_state:'NOT_REQUIRED',
      created_at:now(),
      updated_at:now(),
      completed_at:null
    };
    this.store.mutate(s=>{
      s.tasks.push(task);
      s.queue.push({delivery_id:id('DLV'),task_id:task.task_id,to:task.assigned_to,status:'PENDING',attempts:0,last_error:null});
    });
    this.store.audit({actor:actorId,action:'TASK_CREATED',task_id:task.task_id,target:task.assigned_to,result:'OK'});
    return clone(task);
  }
  task(taskId){
    const t=this.state().tasks.find(x=>x.task_id===taskId);
    if(!t) throw new PlatformError('TASK_NOT_FOUND','Không tìm thấy '+taskId,404);
    return t;
  }
  dispatchNext(agentId,{simulateFailure=false}={}){
    this.agent(agentId);
    return this.store.mutate(s=>{
      const d=s.queue.find(x=>x.to===agentId && (x.status==='PENDING'||x.status==='FAILED'));
      if(!d) return null;
      d.attempts+=1;
      if(simulateFailure){
        d.status='FAILED'; d.last_error='SIMULATED_FAILURE';
        this.store.audit({actor:'SYSTEM',action:'DISPATCH_FAILED',task_id:d.task_id,target:agentId,result:'FAILED'});
        return clone(d);
      }
      d.status='DELIVERED'; d.last_error=null;
      const t=s.tasks.find(x=>x.task_id===d.task_id);
      if(t){t.status='DELIVERED';t.updated_at=now();}
      s.messages.push({message_id:id('MSG'),task_id:d.task_id,from:'SYSTEM',to:agentId,type:'TASK_DELIVERY',payload:{},created_at:now(),read_at:null});
      this.store.audit({actor:'SYSTEM',action:'DISPATCHED',task_id:d.task_id,target:agentId,result:'OK'});
      return clone(d);
    });
  }
  acceptTask(agentId,taskId){
    const t=this.task(taskId);
    if(t.assigned_to!==agentId) throw new PlatformError('TASK_OWNER_DENIED','Task không thuộc '+agentId,403);
    return this.store.mutate(s=>{
      const x=s.tasks.find(v=>v.task_id===taskId); x.status='ACCEPTED'; x.updated_at=now();
      this.store.audit({actor:agentId,action:'TASK_ACCEPTED',task_id:taskId,result:'OK'});
      return clone(x);
    });
  }
  createSubtask(managerId,parentTaskId,input){
    const parent=this.task(parentTaskId);
    if(parent.assigned_to!==managerId) throw new PlatformError('MANAGER_TASK_DENIED','Manager không quản task cha này',403);
    this.assertPermission(managerId,'create_subtask');
    return this.createTask(managerId,{...input,parent_task_id:parentTaskId,project:parent.project});
  }
  sendMessage(from,to,taskId,type,payload={}){
    const a=this.agent(from);
    const b=this.agent(to);
    const t=this.task(taskId);
    const related=(a.reports_to===to)||(b.reports_to===from)||(t.created_by===from&&t.assigned_to===to)||(t.created_by===to&&t.assigned_to===from);
    if(!related) throw new PlatformError('MESSAGE_ROUTE_DENIED','Hai Agent không có tuyến báo cáo phù hợp',403);
    const msg={message_id:id('MSG'),task_id:taskId,from,to,type,payload,created_at:now(),read_at:null};
    this.store.mutate(s=>s.messages.push(msg));
    this.store.audit({actor:from,action:'MESSAGE_SENT',task_id:taskId,target:to,result:'OK'});
    return clone(msg);
  }
  inbox(agentId){ this.agent(agentId); return this.state().messages.filter(x=>x.to===agentId); }
  outbox(agentId){ this.agent(agentId); return this.state().messages.filter(x=>x.from===agentId); }

  writeMemory(actorId,{key,value,visibility='private'}){
    this.agent(actorId);
    const rec={memory_id:id('MEM'),owner:actorId,key,value,visibility,updated_at:now()};
    this.store.mutate(s=>{
      const i=s.memories.findIndex(x=>x.owner===actorId&&x.key===key);
      if(i>=0) s.memories[i]=rec; else s.memories.push(rec);
    });
    this.store.audit({actor:actorId,action:'MEMORY_WRITE',target:actorId,result:'OK'});
    return clone(rec);
  }
  readMemory(requesterId,ownerId,key){
    const requester=this.agent(requesterId);
    const owner=this.agent(ownerId);
    const rec=this.state().memories.find(x=>x.owner===ownerId&&x.key===key);
    if(!rec) return null;
    const isSelf=requesterId===ownerId;
    const isManager=owner.reports_to===requesterId;
    if(!isSelf && !(isManager&&rec.visibility==='shared')) throw new PlatformError('MEMORY_DENIED','Không được đọc memory riêng của '+ownerId,403);
    return clone(rec);
  }

  submitEvidence(agentId,taskId,evidence){
    const t=this.task(taskId);
    if(t.assigned_to!==agentId) throw new PlatformError('EVIDENCE_DENIED','Không phải người thực hiện task',403);
    const ev={evidence_id:id('EVD'),agent_id:agentId,at:now(),...evidence};
    this.store.mutate(s=>{
      const x=s.tasks.find(v=>v.task_id===taskId);
      x.evidence.push(ev); x.status='WAITING_EVIDENCE'; x.updated_at=now();
    });
    this.store.audit({actor:agentId,action:'EVIDENCE_SUBMITTED',task_id:taskId,result:'OK'});
    return clone(ev);
  }

  qaResult(agentId,taskId,result,evidence={}){
    const agent=this.agent(agentId);
    if(agent.role!=='qa') throw new PlatformError('QA_ONLY','Chỉ QA được trả QA PASS/FAIL',403);
    const t=this.task(taskId);
    if(t.assigned_to!==agentId) throw new PlatformError('QA_TASK_DENIED','QA không sở hữu task này',403);
    const status=result==='PASS'?'QA_PASS':result==='FAIL'?'QA_FAIL':null;
    if(!status) throw new PlatformError('QA_RESULT_INVALID','Kết quả QA phải PASS hoặc FAIL');
    this.store.mutate(s=>{
      const x=s.tasks.find(v=>v.task_id===taskId);
      x.status=status; x.updated_at=now();
      x.evidence.push({evidence_id:id('EVD'),agent_id:agentId,at:now(),type:'QA_REPORT',result,...evidence});
    });
    this.store.audit({actor:agentId,action:status,task_id:taskId,result:'OK'});
    return clone(this.task(taskId));
  }

  requestExecution(agentId,taskId,{operation,target_branch='aion-sandbox'}){
    const agent=this.agent(agentId);
    const t=this.task(taskId);
    if(t.assigned_to!==agentId) throw new PlatformError('EXECUTION_TASK_DENIED','Task không thuộc Agent',403);
    if(PRODUCTION_OPS.has(operation)||target_branch==='main') throw new PlatformError('PRODUCTION_HARD_BLOCK','Production bị khóa ở cấp platform',403);
    if(!agent.allowed_tools.includes('trainingbot_safe_executor')) throw new PlatformError('EXECUTOR_DENIED','Agent không được dùng Safe Executor',403);
    if(!['sandbox_build','sandbox_compare'].includes(operation)) throw new PlatformError('EXECUTION_OP_DENIED','Operation sandbox chưa được phép',403);
    const ex={execution_id:id('EXE'),task_id:taskId,agent_id:agentId,project:t.project,operation,target_branch,status:'PENDING_EXTERNAL',start_time:now(),end_time:null,result:null,evidence:null};
    this.store.mutate(s=>s.executions.push(ex));
    this.store.audit({actor:agentId,action:'SAFE_EXECUTOR_REQUESTED',task_id:taskId,target:target_branch,result:'QUEUED'});
    return clone(ex);
  }
  completeExecution(executionId,{result,evidence}){
    return this.store.mutate(s=>{
      const ex=s.executions.find(x=>x.execution_id===executionId);
      if(!ex) throw new PlatformError('EXECUTION_NOT_FOUND','Không thấy execution',404);
      ex.status=result==='PASS'?'SUCCESS':'FAILED'; ex.result=result; ex.evidence=evidence; ex.end_time=now();
      const t=s.tasks.find(x=>x.task_id===ex.task_id);
      if(t) t.evidence.push({evidence_id:id('EVD'),agent_id:ex.agent_id,at:now(),type:'EXECUTOR_RESULT',execution_id:executionId,result,evidence});
      this.store.audit({actor:'EXECUTOR',action:'EXECUTION_RESULT',task_id:ex.task_id,target:executionId,result});
      return clone(ex);
    });
  }

  managerReview(managerId,parentTaskId){
    const manager=this.agent(managerId);
    if(manager.role!=='manager') throw new PlatformError('MANAGER_ONLY','Chỉ Manager được tổng hợp',403);
    const parent=this.task(parentTaskId);
    if(parent.assigned_to!==managerId) throw new PlatformError('MANAGER_TASK_DENIED','Task không thuộc Manager',403);
    const children=this.state().tasks.filter(x=>x.parent_task_id===parentTaskId);
    const qa=children
      .filter(x=>this.agent(x.assigned_to).role==='qa')
      .sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    const latestQa=qa.at(-1);
    const status=!latestQa?'WAITING_EVIDENCE':latestQa.status==='QA_FAIL'?'NEEDS_REWORK':latestQa.status==='QA_PASS'?'MANAGER_REVIEW':'WAITING_EVIDENCE';
    this.store.mutate(s=>{const x=s.tasks.find(v=>v.task_id===parentTaskId);x.status=status;x.updated_at=now();});
    this.store.audit({actor:managerId,action:'MANAGER_REVIEW',task_id:parentTaskId,result:status});
    return clone(this.task(parentTaskId));
  }

  ceoReview(ceoId,taskId,{requiresProduction=false}={}){
    const ceo=this.agent(ceoId);
    if(ceo.role!=='ceo') throw new PlatformError('CEO_ONLY','Chỉ CEO được nghiệm thu cấp CEO',403);
    const t=this.task(taskId);
    if(t.assigned_to!=='TB-01' && t.assigned_to!==ceoId) throw new PlatformError('CEO_SCOPE_DENIED','Task không thuộc tuyến CEO',403);
    const children=this.state().tasks.filter(x=>x.parent_task_id===taskId);
    const qaPass=children.some(x=>x.status==='QA_PASS');
    if(!qaPass) throw new PlatformError('QA_EVIDENCE_REQUIRED','Chưa có QA PASS + evidence',409);
    const next=requiresProduction?'WAITING_OWNER_APPROVAL':'COMPLETED';
    this.store.mutate(s=>{
      const x=s.tasks.find(v=>v.task_id===taskId);
      x.status=next;
      x.approval_state=requiresProduction?'PENDING_OWNER':'NOT_REQUIRED';
      x.completed_at=next==='COMPLETED'?now():null;
      x.updated_at=now();
    });
    this.store.audit({actor:ceoId,action:'CEO_REVIEW',task_id:taskId,result:next});
    return clone(this.task(taskId));
  }

  ownerApprove(ownerId,taskId){
    const owner=this.agent(ownerId);
    if(owner.role!=='owner') throw new PlatformError('OWNER_ONLY','Chỉ Chủ sở hữu được phê duyệt',403);
    const t=this.task(taskId);
    if(t.status!=='WAITING_OWNER_APPROVAL') throw new PlatformError('APPROVAL_STATE_INVALID','Task chưa ở trạng thái chờ Chủ sở hữu',409);
    this.store.mutate(s=>{const x=s.tasks.find(v=>v.task_id===taskId);x.approval_state='APPROVED';x.updated_at=now();});
    this.store.audit({actor:ownerId,action:'OWNER_APPROVED',task_id:taskId,result:'APPROVED'});
    return clone(this.task(taskId));
  }

  timeline(taskId){
    const ids=new Set([taskId]);
    for(const t of this.state().tasks) if(t.parent_task_id===taskId) ids.add(t.task_id);
    return this.store.audits().filter(x=>ids.has(x.task_id));
  }
}

function json(res,status,payload){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(payload,null,2));
}

export function createServer(platform,{apiKey=process.env.AION_PLATFORM_KEY}={}){
  if(!apiKey) throw new Error('AION_PLATFORM_KEY is required');
  return http.createServer(async(req,res)=>{
    try{
      if(req.url==='/health'&&req.method==='GET') return json(res,200,{ok:true,service:'aion-agent-platform'});
      if(req.headers.authorization!=='Bearer '+apiKey) return json(res,401,{error:'UNAUTHORIZED'});
      if(req.url==='/agents'&&req.method==='GET') return json(res,200,platform.state().agents);
      if(req.url==='/tasks'&&req.method==='GET') return json(res,200,platform.state().tasks);
      const m=req.url.match(/^\/inbox\/([^/]+)$/);
      if(m&&req.method==='GET') return json(res,200,platform.inbox(decodeURIComponent(m[1])));
      let body='';
      for await(const chunk of req) body+=chunk;
      const data=body?JSON.parse(body):{};
      if(req.url==='/tasks'&&req.method==='POST') return json(res,201,platform.createTask(data.actor_id,data.task));
      const qa=req.url.match(/^\/tasks\/([^/]+)\/qa-result$/);
      if(qa&&req.method==='POST') return json(res,200,platform.qaResult(data.agent_id,qa[1],data.result,data.evidence||{}));
      const ev=req.url.match(/^\/tasks\/([^/]+)\/evidence$/);
      if(ev&&req.method==='POST') return json(res,201,platform.submitEvidence(data.agent_id,ev[1],data.evidence||{}));
      const ex=req.url.match(/^\/tasks\/([^/]+)\/execution$/);
      if(ex&&req.method==='POST') return json(res,201,platform.requestExecution(data.agent_id,ex[1],data.execution||{}));
      return json(res,404,{error:'NOT_FOUND'});
    }catch(e){
      return json(res,e.status||500,{error:e.code||'INTERNAL_ERROR',message:e.message});
    }
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const p=new AionPlatform({dataDir:process.env.AION_DATA_DIR||path.join(__dirname,'data')});
  const server=createServer(p);
  const port=Number(process.env.PORT||8787);
  server.listen(port,'127.0.0.1',()=>console.log('AION Agent Platform listening on http://127.0.0.1:'+port));
}
