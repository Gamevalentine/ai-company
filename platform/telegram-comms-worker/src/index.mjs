import { DurableObject } from 'cloudflare:workers';
import { hardGate, applyAiGate, dateKey } from './core.mjs';

const SITE='https://trainingbot.io.vn';

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:{'content-type':'application/json; charset=utf-8'}
  });
}

function api(env,method){
  return 'https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method;
}

async function telegram(env,method,payload=null){
  const res=await fetch(api(env,method),payload?{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(payload)
  }:{});
  if(!res.ok) throw new Error('Telegram '+method+' HTTP '+res.status);
  const out=await res.json();
  if(!out.ok) throw new Error('Telegram '+method+' failed');
  return out.result;
}

function compactHtml(html){
  return String(html||'')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,7000);
}

async function approvedContextFor(text){
  const s=String(text||'').toLowerCase();
  const path=/wiki|hướng dẫn|cách/.test(s)?'/wiki'
    :/bản|version|phiên bản|cập nhật|update/.test(s)?'/ban-cap-nhat'
    :/tin|news|mới/.test(s)?'/news'
    :'/';
  let live='';
  try{
    const res=await fetch(SITE+path,{headers:{'user-agent':'TrainingBot-COMMS/1.0'}});
    if(res.ok) live=compactHtml(await res.text());
  }catch{}
  return [
    'Nguồn công khai được duyệt của TrainingBot: '+SITE+'/.',
    'Có thể tham chiếu /news, /wiki và /ban-cap-nhat.',
    'Không được tự đoán phiên bản, ngày phát hành, link tải, chính sách hoặc thông tin game.',
    'Nếu context dưới đây không đủ chắc chắn, confidence phải dưới 0.90.',
    '',
    live
  ].join('\n').slice(0,9000);
}

async function classifyWithAi(env,message,context){
  const content=String(message.text||message.caption||'').slice(0,1800);
  const prompt=[
    'Bạn là COMMS-TB-01, nhân viên chăm sóc cộng đồng của TrainingBot trên Telegram.',
    'Chỉ trả lời câu hỏi TrainingBot/PUBG khi dữ liệu công khai đủ chắc chắn.',
    'Không trả lời nội dung mật khẩu, token, tài khoản bị hack, thanh toán, hoàn tiền, pháp lý hoặc dữ liệu cá nhân.',
    'Nếu dữ liệu không đủ, classification phải là UNCERTAIN_OR_SENSITIVE hoặc confidence dưới 0.90.',
    'Trả lời cùng ngôn ngữ với người dùng, ngắn gọn.',
    'Chỉ xuất JSON với classification, confidence, proposed_reply, reason.',
    '',
    'TIN NHẮN:',
    content,
    '',
    'NGỮ CẢNH:',
    context
  ].join('\n');

  const result=await env.AI.run(
    env.AI_MODEL||'@cf/meta/llama-3.2-1b-instruct',
    {
      messages:[
        {role:'system',content:'Return JSON only. classification must be USER_GAME_OR_TRAININGBOT_QUESTION, ACCOUNT_OR_SYSTEM_NOTIFICATION, or UNCERTAIN_OR_SENSITIVE.'},
        {role:'user',content:prompt}
      ],
      max_tokens:260,
      temperature:0
    }
  );

  const raw=typeof result==='string'?result:(result?.response||result?.result||'');
  const match=String(raw).match(/\{[\s\S]*\}/);
  if(!match) return {classification:'UNCERTAIN_OR_SENSITIVE',confidence:0,proposed_reply:'',reason:'invalid-ai-output'};
  try{return JSON.parse(match[0]);}
  catch{return {classification:'UNCERTAIN_OR_SENSITIVE',confidence:0,proposed_reply:'',reason:'invalid-ai-json'};}
}

export class TelegramCommsState extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    this.state=ctx;
    this.env=env;
  }

  async getOffset(){
    return Number((await this.state.storage.get('offset'))||0);
  }

  async setOffset(value){
    await this.state.storage.put('offset',Number(value));
  }

  async aiBudgetTake(){
    const key='ai:'+dateKey();
    const used=Number((await this.state.storage.get(key))||0);
    const cap=Math.max(1,Math.min(100,Number(this.env.MAX_AI_CALLS_PER_DAY||40)));
    if(used>=cap) return false;
    await this.state.storage.put(key,used+1);
    return true;
  }

  async markProcessed(updateId,result){
    await this.state.storage.put('update:'+updateId,{at:new Date().toISOString(),result});
  }

  async initialize(){
    const env=this.env;
    if(!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    const me=await telegram(env,'getMe');
    const updates=await telegram(env,'getUpdates',{offset:-1,limit:1,timeout:0,allowed_updates:['message']});
    if(updates.length) await this.setOffset(Number(updates[0].update_id)+1);
    return {ok:true,bot_username:me.username||null,offset_initialized:true,discarded_backlog:true};
  }

  async poll(){
    const env=this.env;
    if(!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    if(!env.TELEGRAM_ALLOWED_CHAT_ID) throw new Error('TELEGRAM_ALLOWED_CHAT_ID is not configured');

    const me=await telegram(env,'getMe');
    const offset=await this.getOffset();
    if(!offset) return this.initialize();

    const updates=await telegram(env,'getUpdates',{
      offset,
      limit:50,
      timeout:0,
      allowed_updates:['message']
    });

    let seen=0,replied=0,ignored=0,escalated=0,aiCalls=0;
    const allowedChat=String(env.TELEGRAM_ALLOWED_CHAT_ID);

    for(const update of updates){
      const next=Number(update.update_id)+1;
      const message=update.message;
      if(!message){
        await this.setOffset(next);
        continue;
      }

      seen++;
      const chatId=String(message.chat?.id||'');
      if(chatId!==allowedChat){
        ignored++;
        await this.markProcessed(update.update_id,'OUTSIDE_APPROVED_CHAT');
        await this.setOffset(next);
        continue;
      }

      const gate=hardGate(message,{botId:me.id,botUsername:me.username||''});
      if(gate.decision==='IGNORE'){
        ignored++;
        await this.markProcessed(update.update_id,gate.reason);
        await this.setOffset(next);
        continue;
      }
      if(gate.decision==='ESCALATE'){
        escalated++;
        await this.markProcessed(update.update_id,'ESCALATE');
        await this.setOffset(next);
        continue;
      }

      if(!(await this.aiBudgetTake())){
        await this.markProcessed(update.update_id,'AI_DAILY_CAP');
        await this.setOffset(next);
        continue;
      }

      aiCalls++;
      const context=await approvedContextFor(message.text||message.caption||'');
      let ai;
      try{ ai=await classifyWithAi(env,message,context); }
      catch{
        await this.markProcessed(update.update_id,'AI_ERROR');
        await this.setOffset(next);
        continue;
      }

      const decision=applyAiGate(ai);
      if(decision.decision==='AUTO_REPLY'){
        await telegram(env,'sendMessage',{
          chat_id:message.chat.id,
          text:decision.reply,
          reply_parameters:{message_id:message.message_id}
        });
        replied++;
        await this.markProcessed(update.update_id,'AUTO_REPLY');
      }else{
        await this.markProcessed(update.update_id,'NO_REPLY');
      }

      await this.setOffset(next);
    }

    return {
      ok:true,
      bot_username:me.username||null,
      allowed_chat_id:allowedChat,
      seen,replied,ignored,escalated,
      ai_calls:aiCalls,
      free_guard:{max_ai_calls_per_day:Number(env.MAX_AI_CALLS_PER_DAY||40)}
    };
  }
}

function stateStub(env){
  const id=env.TELEGRAM_COMMS_STATE.idFromName('trainingbot-telegram-comms');
  return env.TELEGRAM_COMMS_STATE.get(id);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/health'){
      return json({ok:true,service:'trainingbot-comms-telegram',mode:'scheduled-polling'});
    }
    if(url.pathname==='/run'){
      const key=request.headers.get('authorization');
      if(!env.ADMIN_KEY || key!=='Bearer '+env.ADMIN_KEY) return json({error:'UNAUTHORIZED'},401);
      try{return json(await stateStub(env).poll());}
      catch(error){return json({ok:false,error:error.message},500);}
    }
    if(url.pathname==='/initialize'){
      const key=request.headers.get('authorization');
      if(!env.ADMIN_KEY || key!=='Bearer '+env.ADMIN_KEY) return json({error:'UNAUTHORIZED'},401);
      try{return json(await stateStub(env).initialize());}
      catch(error){return json({ok:false,error:error.message},500);}
    }
    return new Response('Not found',{status:404});
  },

  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      try{
        const result=await stateStub(env).poll();
        console.log(JSON.stringify({event:'TELEGRAM_COMMS_POLL',...result}));
      }catch(error){
        console.error(JSON.stringify({event:'TELEGRAM_COMMS_POLL_FAILED',message:error.message}));
      }
    })());
  }
};
