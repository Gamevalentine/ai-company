import crypto from 'node:crypto';

function required(env,name){
  const v=env[name];
  if(!v) throw new Error('Missing required connector credential: '+name);
  return v;
}

function base64url(input){
  return Buffer.from(input,'utf8').toString('base64')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

export function connectorStatus(env=process.env){
  return {
    gmail:{
      configured:Boolean(env.GMAIL_CLIENT_ID&&env.GMAIL_CLIENT_SECRET&&env.GMAIL_REFRESH_TOKEN),
      identity:env.GMAIL_FROM||'trainingbot.ai2@gmail.com'
    },
    facebook:{
      configured:Boolean(env.META_PAGE_ID&&env.META_PAGE_ACCESS_TOKEN),
      page_id:env.META_PAGE_ID||null
    },
    telegram:{
      configured:Boolean(env.TELEGRAM_BOT_TOKEN),
      allowed_chat_id:env.TELEGRAM_ALLOWED_CHAT_ID||null
    }
  };
}

export async function gmailAccessToken(env,fetchImpl){
  const clientId=required(env,'GMAIL_CLIENT_ID');
  const clientSecret=required(env,'GMAIL_CLIENT_SECRET');
  const refreshToken=required(env,'GMAIL_REFRESH_TOKEN');

  const body=new URLSearchParams({
    client_id:clientId,
    client_secret:clientSecret,
    refresh_token:refreshToken,
    grant_type:'refresh_token'
  });

  const res=await fetchImpl('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body
  });
  if(!res.ok) throw new Error('Gmail OAuth refresh failed: '+res.status);
  const json=await res.json();
  if(!json.access_token) throw new Error('Gmail OAuth refresh returned no access token');
  return json.access_token;
}

export async function getGmailProfile({env=process.env,fetchImpl=fetch}={}){
  const token=await gmailAccessToken(env,fetchImpl);
  const res=await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile',{
    headers:{authorization:'Bearer '+token}
  });
  if(!res.ok) throw new Error('Gmail profile read failed: '+res.status);
  const out=await res.json();
  return {email_address:out.emailAddress||null,messages_total:out.messagesTotal??null,threads_total:out.threadsTotal??null};
}

export async function listGmailLabels({env=process.env,fetchImpl=fetch}={}){
  const token=await gmailAccessToken(env,fetchImpl);
  const res=await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/labels',{
    headers:{authorization:'Bearer '+token}
  });
  if(!res.ok) throw new Error('Gmail label list failed: '+res.status);
  const out=await res.json();
  return Array.isArray(out.labels)?out.labels.map(x=>({id:x.id,name:x.name,type:x.type||null})):[];
}

export async function searchGmailMessages(query,{env=process.env,fetchImpl=fetch}={}){
  const token=await gmailAccessToken(env,fetchImpl);
  const res=await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages?q='+encodeURIComponent(query)+'&maxResults=10',{
    headers:{authorization:'Bearer '+token}
  });
  if(!res.ok) throw new Error('Gmail search failed: '+res.status);
  const out=await res.json();
  return Array.isArray(out.messages)?out.messages:[];
}

export async function applyGmailLabel(messageId,labelName,{env=process.env,fetchImpl=fetch}={}){
  const labels=await listGmailLabels({env,fetchImpl});
  const label=labels.find(x=>x.name===labelName);
  if(!label) throw new Error('Gmail label not found: '+labelName);
  const token=await gmailAccessToken(env,fetchImpl);
  const res=await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(messageId)+'/modify',{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({addLabelIds:[label.id]})
  });
  if(!res.ok) throw new Error('Gmail label apply failed: '+res.status);
  const out=await res.json();
  return {message_id:out.id||messageId,label_name:labelName,labeled:true};
}

export async function sendGmailReply(action,{env=process.env,fetchImpl=fetch}={}){
  const from=env.GMAIL_FROM||'trainingbot.ai2@gmail.com';
  if(from!=='trainingbot.ai2@gmail.com') throw new Error('COMMS Gmail identity is locked to trainingbot.ai2@gmail.com');
  const to=String(action.to||'').trim();
  const subject=String(action.subject||'').trim();
  const body=String(action.body||'').trim();
  if(!to||!subject||!body) throw new Error('Gmail reply requires to, subject, and body');

  const token=await gmailAccessToken(env,fetchImpl);
  const message=[
    'From: TrainingBot <'+from+'>',
    'To: '+to,
    'Subject: '+subject,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body
  ].join('\r\n');

  const payload={raw:base64url(message)};
  if(action.thread_id) payload.threadId=action.thread_id;

  const res=await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
    method:'POST',
    headers:{
      authorization:'Bearer '+token,
      'content-type':'application/json'
    },
    body:JSON.stringify(payload)
  });
  if(!res.ok) throw new Error('Gmail send failed: '+res.status);
  const out=await res.json();
  return {channel:'gmail',sent:true,message_id:out.id||null,thread_id:out.threadId||action.thread_id||null};
}

export async function replyFacebookComment(action,{env=process.env,fetchImpl=fetch}={}){
  const token=required(env,'META_PAGE_ACCESS_TOKEN');
  const commentId=String(action.comment_id||'').trim();
  const message=String(action.body||'').trim();
  if(!commentId||!message) throw new Error('Facebook comment reply requires comment_id and body');
  const version=env.META_GRAPH_VERSION||'v25.0';
  const url='https://graph.facebook.com/'+version+'/'+encodeURIComponent(commentId)+'/comments';
  const res=await fetchImpl(url,{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({message})
  });
  if(!res.ok) throw new Error('Facebook comment reply failed: '+res.status);
  const out=await res.json();
  return {channel:'facebook_comment_thread',sent:true,comment_id:out.id||null};
}

export async function replyFacebookMessenger(action,{env=process.env,fetchImpl=fetch}={}){
  const token=required(env,'META_PAGE_ACCESS_TOKEN');
  const pageId=required(env,'META_PAGE_ID');
  const recipientId=String(action.recipient_id||'').trim();
  const message=String(action.body||'').trim();
  if(!recipientId||!message) throw new Error('Messenger reply requires recipient_id and body');
  const version=env.META_GRAPH_VERSION||'v25.0';
  const url='https://graph.facebook.com/'+version+'/'+encodeURIComponent(pageId)+'/messages';
  const res=await fetchImpl(url,{
    method:'POST',
    headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({
      recipient:{id:recipientId},
      messaging_type:'RESPONSE',
      message:{text:message}
    })
  });
  if(!res.ok) throw new Error('Messenger reply failed: '+res.status);
  const out=await res.json();
  return {channel:'facebook_messenger',sent:true,message_id:out.message_id||null,recipient_id:out.recipient_id||recipientId};
}

export async function sendTelegramReply(action,{env=process.env,fetchImpl=fetch}={}){
  const token=required(env,'TELEGRAM_BOT_TOKEN');
  const chatId=String(action.chat_id||'').trim();
  const body=String(action.body||'').trim();
  if(!chatId||!body) throw new Error('Telegram reply requires chat_id and body');
  const allowed=String(env.TELEGRAM_ALLOWED_CHAT_ID||'').trim();
  if(allowed && chatId!==allowed) throw new Error('Telegram chat is outside the approved TrainingBot community');
  const res=await fetchImpl('https://api.telegram.org/bot'+token+'/sendMessage',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      chat_id:chatId,
      text:body.slice(0,4000),
      ...(action.reply_to_message_id?{reply_parameters:{message_id:Number(action.reply_to_message_id)}}:{})
    })
  });
  if(!res.ok) throw new Error('Telegram send failed: '+res.status);
  const out=await res.json();
  if(!out.ok) throw new Error('Telegram API rejected send');
  return {channel:'same_telegram_chat',sent:true,message_id:out.result?.message_id||null,chat_id:String(out.result?.chat?.id||chatId)};
}

export async function sendDiscordChannelReply(action,{env=process.env,fetchImpl=fetch}={}){
  const token=required(env,'DISCORD_BOT_TOKEN');
  const channelId=String(action.channel_id||'').trim();
  const body=String(action.body||'').trim();
  if(!channelId||!body) throw new Error('Discord reply requires channel_id and body');
  const res=await fetchImpl('https://discord.com/api/v10/channels/'+encodeURIComponent(channelId)+'/messages',{
    method:'POST',
    headers:{authorization:'Bot '+token,'content-type':'application/json'},
    body:JSON.stringify({
      content:body.slice(0,2000),
      ...(action.reply_to_message_id?{message_reference:{message_id:String(action.reply_to_message_id)}}:{})
    })
  });
  if(!res.ok) throw new Error('Discord send failed: '+res.status);
  const out=await res.json();
  return {channel:'same_discord_channel',sent:true,message_id:out.id||null,channel_id:out.channel_id||channelId};
}

export async function executeCommsOutbound(action,options={}){
  if(!action||action.approved!==true) throw new Error('Outbound COMMS action must be explicitly approved by the COMMS gate');
  if(action.decision!=='AUTO_REPLY') throw new Error('Only AUTO_REPLY actions may be sent automatically');

  if(action.channel==='gmail') return sendGmailReply(action,options);
  if(action.channel==='facebook_comment_thread') return replyFacebookComment(action,options);
  if(action.channel==='facebook_messenger') return replyFacebookMessenger(action,options);
  if(action.channel==='same_telegram_chat') return sendTelegramReply(action,options);
  throw new Error('Unsupported COMMS outbound channel: '+action.channel);
}

export function createActionId(action){
  const raw=JSON.stringify({
    channel:action.channel,
    target:action.to||action.comment_id||action.recipient_id||action.chat_id||action.channel_id||'',
    body:action.body||'',
    thread:action.thread_id||action.reply_to_message_id||''
  });
  return 'COMMS-'+crypto.createHash('sha256').update(raw).digest('hex').slice(0,16);
}
