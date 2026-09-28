import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODEL=process.env.AION_LOCAL_MODEL||'qwen2.5:1.5b-instruct';
const URL=process.env.OLLAMA_URL||'http://127.0.0.1:11434';

export const CLASSES=[
  'USER_GAME_OR_TRAININGBOT_QUESTION',
  'ACCOUNT_OR_SYSTEM_NOTIFICATION',
  'UNCERTAIN_OR_SENSITIVE'
];

export const DECISIONS=[
  'AUTO_REPLY',
  'DRAFT_ONLY',
  'ESCALATE',
  'IGNORE_NOTIFICATION'
];

const SCHEMA={
  type:'object',
  properties:{
    classification:{type:'string',enum:CLASSES},
    confidence:{type:'number',minimum:0,maximum:1},
    intent:{type:'string',maxLength:220},
    reason:{type:'string',maxLength:320},
    proposed_reply:{type:'string',maxLength:1200},
    sensitive_flags:{type:'array',maxItems:8,items:{type:'string',maxLength:120}}
  },
  required:['classification','confidence','intent','reason','proposed_reply','sensitive_flags']
};

function norm(v){ return String(v||'').toLowerCase(); }

function sanitizeReply(value){
  const text=String(value||'').trim();
  if(!text) return '';
  const parts=text.split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const seen=new Set();
  const kept=[];
  for(const part of parts){
    const key=part.toLowerCase().replace(/\s+/g,' ');
    if(seen.has(key)) continue;
    seen.add(key);
    kept.push(part);
    if(kept.join(' ').length>=650) break;
  }
  return kept.join(' ').slice(0,700).trim();
}

export function routeForSource(source){
  const map={
    'trainingbot.io.vn':{reply_channel:'gmail',reply_identity:'trainingbot.ai2@gmail.com'},
    'website':{reply_channel:'gmail',reply_identity:'trainingbot.ai2@gmail.com'},
    'email':{reply_channel:'gmail',reply_identity:'trainingbot.ai2@gmail.com'},
    'facebook_comment':{reply_channel:'facebook_comment_thread',reply_identity:'same_facebook_page'},
    'facebook_messenger':{reply_channel:'facebook_messenger',reply_identity:'same_facebook_page'},
    'telegram_community':{reply_channel:'same_telegram_chat',reply_identity:'same_telegram_bot'}
  };
  return map[source]||{reply_channel:'manager_review',reply_identity:'TB-01'};
}

export function hardClassify(message={}){
  const sender=norm(message.sender);
  const subject=norm(message.subject);
  const body=norm(message.body);
  const headers=Object.fromEntries(Object.entries(message.headers||{}).map(([k,v])=>[k.toLowerCase(),norm(v)]));
  const all=[sender,subject,body,headers['auto-submitted'],headers['precedence'],headers['list-unsubscribe']].join(' ');

  const notificationSignals=[
    /(^|[^a-z])no-?reply([^a-z]|$)/,
    /(^|[^a-z])noreply([^a-z]|$)/,
    /verification code/,
    /mã xác minh/,
    /one[- ]time password/,
    /\botp\b/,
    /login alert/,
    /cảnh báo đăng nhập/,
    /new sign[- ]in/,
    /password (changed|reset)/,
    /security alert/,
    /auto-submitted/,
    /precedence bulk/,
    /list-unsubscribe/
  ];

  const sensitiveSignals=[
    /refund|hoàn tiền/,
    /payment|thanh toán|billing/,
    /legal|pháp lý|lawyer/,
    /hack|hacked|xâm nhập|bị chiếm/,
    /password|mật khẩu/,
    /credential|api key|token|secret/,
    /delete (my )?(account|data)|xóa (tài khoản|dữ liệu)/,
    /bank|ngân hàng|credit card|thẻ tín dụng/,
    /personal data|dữ liệu cá nhân/
  ];

  const notification=notificationSignals.some(r=>r.test(all));
  const sensitive=sensitiveSignals.filter(r=>r.test(subject+' '+body)).map(r=>r.source);

  if(notification){
    return {
      forced_classification:'ACCOUNT_OR_SYSTEM_NOTIFICATION',
      forced_decision:'IGNORE_NOTIFICATION',
      reason:'Hard notification filter matched',
      sensitive_flags:[]
    };
  }
  if(sensitive.length){
    return {
      forced_classification:'UNCERTAIN_OR_SENSITIVE',
      forced_decision:'ESCALATE',
      reason:'Sensitive or owner-gated topic matched',
      sensitive_flags:sensitive
    };
  }
  return null;
}

export function applyCommsGate(ai,message={}){
  const hard=hardClassify(message);
  const route=routeForSource(message.source);

  if(hard){
    return {
      classification:hard.forced_classification,
      decision:hard.forced_decision,
      confidence:1,
      route,
      reason:hard.reason,
      proposed_reply:'',
      sensitive_flags:hard.sensitive_flags,
      overridden:true
    };
  }

  const classification=CLASSES.includes(ai?.classification)?ai.classification:'UNCERTAIN_OR_SENSITIVE';
  const confidence=Math.max(0,Math.min(1,Number(ai?.confidence)||0));
  const approvedContext=String(message.approved_context||'').trim();

  if(classification==='ACCOUNT_OR_SYSTEM_NOTIFICATION'){
    return {
      classification,
      decision:'IGNORE_NOTIFICATION',
      confidence,
      route,
      reason:'AI classified the message as an account/system notification',
      proposed_reply:'',
      sensitive_flags:ai?.sensitive_flags||[],
      overridden:false
    };
  }

  if(classification==='UNCERTAIN_OR_SENSITIVE'||confidence<0.60){
    return {
      classification,
      decision:'ESCALATE',
      confidence,
      route,
      reason:'Low confidence or sensitive/uncertain content',
      proposed_reply:sanitizeReply(ai?.proposed_reply),
      sensitive_flags:ai?.sensitive_flags||[],
      overridden:false
    };
  }

  if(confidence<0.90||!approvedContext){
    return {
      classification,
      decision:'DRAFT_ONLY',
      confidence,
      route,
      reason:!approvedContext
        ? 'No approved public context was supplied for safe automatic answering'
        : 'Confidence is below the automatic-reply threshold',
      proposed_reply:sanitizeReply(ai?.proposed_reply),
      sensitive_flags:ai?.sensitive_flags||[],
      overridden:false
    };
  }

  return {
    classification,
    decision:'AUTO_REPLY',
    confidence,
    route,
    reason:'High-confidence user question grounded in approved context',
    proposed_reply:sanitizeReply(ai?.proposed_reply),
    sensitive_flags:ai?.sensitive_flags||[],
    overridden:false
  };
}

async function ask(message,fetchImpl=fetch){
  let lastError=null;
  const system=[
    'You are COMMS-TB-01, TrainingBot community and support communications agent.',
    'Classify inbound messages into USER_GAME_OR_TRAININGBOT_QUESTION, ACCOUNT_OR_SYSTEM_NOTIFICATION, or UNCERTAIN_OR_SENSITIVE.',
    'Use only the supplied approved_context when composing factual replies. If approved_context is absent or insufficient, keep the reply cautious and do not invent facts, versions, dates, links, policies, or game information.',
    'Do not answer requests about passwords, credentials, account security, refunds, payments, legal matters, deletion of data, or other sensitive matters; those must be escalated.',
    'Do not respond to automated account/system notifications.',
    'Reply in the language used by the sender when clear.',
    'Return structured JSON only.'
  ].join('\n');

  const user=JSON.stringify({
    source:message.source,
    sender:message.sender,
    subject:message.subject||'',
    body:message.body||'',
    approved_context:message.approved_context||''
  });

  for(let attempt=1;attempt<=2;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),120000);
    try{
      const res=await fetchImpl(URL+'/api/chat',{
        method:'POST',
        headers:{'content-type':'application/json'},
        signal:controller.signal,
        body:JSON.stringify({
          model:MODEL,
          stream:false,
          format:SCHEMA,
          options:{temperature:0,num_predict:900},
          messages:[{role:'system',content:system},{role:'user',content:user}]
        })
      });
      if(!res.ok) throw new Error('Ollama '+res.status);
      const out=await res.json();
      const content=out?.message?.content;
      if(!content) throw new Error('Empty COMMS model response');
      return {parsed:JSON.parse(content),model:out.model||MODEL,attempt};
    }catch(error){
      lastError=error;
      if(attempt<2) await new Promise(r=>setTimeout(r,1000));
    }finally{
      clearTimeout(timer);
    }
  }
  throw new Error('COMMS brain failed after 2 attempts: '+(lastError?.message||String(lastError)));
}

export async function processInboundMessage(message,{fetchImpl=fetch}={}){
  const hard=hardClassify(message);
  if(hard){
    const gated=applyCommsGate({},message);
    return {
      agent_id:'COMMS-TB-01',
      ...gated,
      intent:'hard-filtered',
      model:null,
      model_attempt:0,
      processed_at:new Date().toISOString(),
      external_send_performed:false
    };
  }

  const ai=await ask(message,fetchImpl);
  const gated=applyCommsGate(ai.parsed,message);
  return {
    agent_id:'COMMS-TB-01',
    ...gated,
    intent:ai.parsed.intent,
    model:ai.model,
    model_attempt:ai.attempt,
    processed_at:new Date().toISOString(),
    external_send_performed:false
  };
}

export function labelForResult(result){
  if(result.decision==='IGNORE_NOTIFICATION') return 'TB-THONG-BAO';
  if(result.decision==='ESCALATE'||result.decision==='DRAFT_ONLY') return 'TB-CAN-XEM';
  if(result.decision==='AUTO_REPLY') return 'TB-HOI-GAME';
  return 'TB-CAN-XEM';
}

export function renderCommsMarkdown(report){
  return [
    '# COMMS-TB-01 report','',
    '- Classification: **'+report.classification+'**',
    '- Decision: **'+report.decision+'**',
    '- Confidence: **'+String(report.confidence)+'**',
    '- Reply channel: **'+report.route.reply_channel+'**',
    '- Reply identity: **'+report.route.reply_identity+'**',
    '- External send performed: **NO**','',
    '## Reason',report.reason||'No reason','',
    '## Draft reply',report.proposed_reply||'(none)'
  ].join('\n');
}

function arg(name){ const i=process.argv.indexOf(name); return i>=0?process.argv[i+1]:null; }

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv[2]!=='process') throw new Error('Unknown command');
  const input=arg('--input'), output=arg('--output'), markdown=arg('--markdown');
  if(!input||!output) throw new Error('Missing arguments');
  const message=JSON.parse(fs.readFileSync(input,'utf8'));
  const report=await processInboundMessage(message);
  report.label=labelForResult(report);
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  if(markdown) fs.writeFileSync(markdown,renderCommsMarkdown(report)+'\n');
  console.log(JSON.stringify({ok:true,agent_id:report.agent_id,classification:report.classification,decision:report.decision,route:report.route.reply_channel,label:report.label}));
}
