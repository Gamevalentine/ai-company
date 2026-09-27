import {
  DEFAULT_CHANNEL_NAMES,
  hardGate,
  applyAiGate,
  dateKey
} from './core.mjs';

const API='https://discord.com/api/v10';
const SITE='https://trainingbot.io.vn';

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{
    status,
    headers:{'content-type':'application/json; charset=utf-8'}
  });
}

function authHeaders(env){
  return {authorization:'Bot '+env.DISCORD_BOT_TOKEN,'content-type':'application/json'};
}

async function discordFetch(env,path,init={}){
  const res=await fetch(API+path,{
    ...init,
    headers:{...authHeaders(env),...(init.headers||{})}
  });
  if(res.status===429){
    const retry=await res.json().catch(()=>({}));
    const wait=Math.ceil(Number(retry.retry_after||1)*1000);
    await new Promise(r=>setTimeout(r,Math.min(wait,5000)));
    return discordFetch(env,path,init);
  }
  if(!res.ok){
    const body=await res.text().catch(()=>'');
    throw new Error('Discord '+res.status+' '+path+' '+body.slice(0,180));
  }
  if(res.status===204) return null;
  return res.json();
}

async function getBot(env){
  return discordFetch(env,'/users/@me');
}

async function getGuild(env){
  return discordFetch(env,'/guilds/'+encodeURIComponent(env.DISCORD_GUILD_ID));
}

async function getChannels(env){
  return discordFetch(env,'/guilds/'+encodeURIComponent(env.DISCORD_GUILD_ID)+'/channels');
}

async function getMessagesAfter(env,channelId,after){
  const qs=new URLSearchParams({limit:'50'});
  if(after) qs.set('after',after);
  const rows=await discordFetch(env,'/channels/'+encodeURIComponent(channelId)+'/messages?'+qs);
  return Array.isArray(rows)?rows.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1):[];
}

async function sendReply(env,channelId,messageId,body){
  return discordFetch(env,'/channels/'+encodeURIComponent(channelId)+'/messages',{
    method:'POST',
    body:JSON.stringify({
      content:body,
      allowed_mentions:{parse:[],replied_user:false},
      message_reference:{message_id:String(messageId),fail_if_not_exists:false}
    })
  });
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
  const stable=[
    'Nguồn chính thức của TrainingBot: '+SITE+'/.',
    'Các khu vực công khai được phép tham chiếu: /news, /wiki, /ban-cap-nhat.',
    'Chỉ trả lời bằng thông tin có trong ngữ cảnh công khai bên dưới. Không được tự đoán phiên bản, ngày phát hành, link tải, chính sách hay thông tin game.',
    'Nếu ngữ cảnh không đủ để trả lời chắc chắn, phải hạ confidence xuống dưới 0.90 và không bịa thông tin.'
  ].join(' ');
  return (stable+'\n\nPUBLIC_PAGE_CONTEXT:\n'+live).slice(0,9000);
}

async function classifyWithAi(env,message,context){
  const prompt=[
    'Bạn là COMMS-TB-01, nhân viên chăm sóc cộng đồng của TrainingBot.',
    'Phân loại tin nhắn Discord và chỉ trả lời câu hỏi TrainingBot/PUBG khi có dữ liệu công khai đủ chắc chắn.',
    'Không trả lời nội dung mật khẩu, token, tài khoản bị hack, thanh toán, hoàn tiền, pháp lý hoặc dữ liệu cá nhân.',
    'Nếu dữ liệu công khai không đủ, classification phải là UNCERTAIN_OR_SENSITIVE hoặc confidence dưới 0.90.',
    'Trả lời cùng ngôn ngữ với người dùng, ngắn gọn, không quảng cáo, không @everyone/@here.',
    'Chỉ xuất JSON hợp lệ với các khóa classification, confidence, proposed_reply, reason.',
    '',
    'TIN NHẮN:',
    String(message.content||'').slice(0,1800),
    '',
    'NGỮ CẢNH ĐƯỢC DUYỆT:',
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

export class DiscordCommsState {
  constructor(state,env){
    this.state=state;
    this.env=env;
  }

  async getCursor(channelId){
    return (await this.state.storage.get('cursor:'+channelId))||null;
  }

  async setCursor(channelId,messageId){
    await this.state.storage.put('cursor:'+channelId,String(messageId));
  }

  async aiBudgetTake(){
    const key='ai:'+dateKey();
    const used=Number((await this.state.storage.get(key))||0);
    const cap=Math.max(1,Math.min(100,Number(this.env.MAX_AI_CALLS_PER_DAY||40)));
    if(used>=cap) return false;
    await this.state.storage.put(key,used+1);
    return true;
  }

  async markProcessed(messageId,result){
    await this.state.storage.put('msg:'+messageId,{
      at:new Date().toISOString(),
      result
    });
  }

  async poll(){
    const env=this.env;
    if(!env.DISCORD_BOT_TOKEN||!env.DISCORD_GUILD_ID) throw new Error('Discord credentials are not configured');

    const [bot,guild,channels]=await Promise.all([getBot(env),getGuild(env),getChannels(env)]);
    if(guild.id!==env.DISCORD_GUILD_ID) throw new Error('Guild mismatch');

    const configured=String(env.DISCORD_CHANNEL_NAMES||'')
      .split(',')
      .map(x=>x.trim())
      .filter(Boolean);
    const allowedNames=new Set(configured.length?configured:DEFAULT_CHANNEL_NAMES);
    const textChannels=channels.filter(c=>c.type===0 && allowedNames.has(c.name));

    let seen=0, replied=0, escalated=0, ignored=0, aiCalls=0;

    for(const channel of textChannels){
      let cursor=await this.getCursor(channel.id);
      const rows=await getMessagesAfter(env,channel.id,cursor);

      // Bootstrap safely: never answer old history on the first run.
      if(!cursor){
        const newest=rows.at(-1);
        if(newest) await this.setCursor(channel.id,newest.id);
        continue;
      }

      for(const message of rows){
        seen++;
        const gate=hardGate(message,{botUserId:bot.id});
        if(gate.decision==='IGNORE'){
          ignored++;
          await this.markProcessed(message.id,gate.reason);
          await this.setCursor(channel.id,message.id);
          continue;
        }
        if(gate.decision==='ESCALATE'){
          escalated++;
          await this.markProcessed(message.id,'ESCALATE');
          await this.setCursor(channel.id,message.id);
          continue;
        }

        if(!(await this.aiBudgetTake())){
          await this.markProcessed(message.id,'AI_DAILY_CAP');
          await this.setCursor(channel.id,message.id);
          continue;
        }

        aiCalls++;
        const context=await approvedContextFor(message.content);
        let ai;
        try{
          ai=await classifyWithAi(env,message,context);
        }catch(error){
          await this.markProcessed(message.id,'AI_ERROR');
          await this.setCursor(channel.id,message.id);
          continue;
        }

        const decision=applyAiGate(ai);
        if(decision.decision==='AUTO_REPLY'){
          await sendReply(env,channel.id,message.id,decision.reply);
          replied++;
          await this.markProcessed(message.id,'AUTO_REPLY');
        }else{
          await this.markProcessed(message.id,'NO_REPLY');
        }
        await this.setCursor(channel.id,message.id);
      }
    }

    return {
      ok:true,
      bot:bot.username,
      guild:guild.name,
      channels:textChannels.map(x=>x.name),
      seen,
      replied,
      escalated,
      ignored,
      ai_calls:aiCalls,
      free_guard:{max_ai_calls_per_day:Number(env.MAX_AI_CALLS_PER_DAY||40)}
    };
  }
}

async function stateStub(env){
  const id=env.DISCORD_COMMS_STATE.idFromName('trainingbot-discord-comms');
  return env.DISCORD_COMMS_STATE.get(id);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/health'){
      return json({
        ok:true,
        service:'trainingbot-comms-discord',
        mode:'scheduled-polling',
        external_send:'low-risk-auto-reply-only'
      });
    }
    if(url.pathname==='/run'){
      const key=request.headers.get('authorization');
      if(!env.ADMIN_KEY || key!=='Bearer '+env.ADMIN_KEY) return json({error:'UNAUTHORIZED'},401);
      try{return json(await (await stateStub(env)).poll());}
      catch(error){return json({ok:false,error:error.message},500);}
    }
    return new Response('Not found',{status:404});
  },

  async scheduled(controller,env,ctx){
    ctx.waitUntil((async()=>{
      try{
        const result=await (await stateStub(env)).poll();
        console.log(JSON.stringify({event:'DISCORD_COMMS_POLL',...result}));
      }catch(error){
        console.error(JSON.stringify({event:'DISCORD_COMMS_POLL_FAILED',message:error.message}));
      }
    })());
  }
};
