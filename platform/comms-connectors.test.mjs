import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectorStatus,
  executeCommsOutbound,
  sendGmailReply,
  replyFacebookComment,
  replyFacebookMessenger,
  sendDiscordChannelReply
} from './comms-connectors.mjs';

test('connector status stays locked when credentials are absent',()=>{
  const s=connectorStatus({});
  assert.equal(s.gmail.configured,false);
  assert.equal(s.facebook.configured,false);
  assert.equal(s.discord.configured,false);
  assert.equal(s.gmail.identity,'trainingbot.ai2@gmail.com');
});

test('outbound execution rejects unapproved or non-auto actions',async()=>{
  await assert.rejects(()=>executeCommsOutbound({approved:false,decision:'AUTO_REPLY',channel:'gmail'}));
  await assert.rejects(()=>executeCommsOutbound({approved:true,decision:'DRAFT_ONLY',channel:'gmail'}));
});

test('Gmail connector refreshes OAuth and sends only as TrainingBot mailbox',async()=>{
  const calls=[];
  const fetchImpl=async(url,opts)=>{
    calls.push({url,opts});
    if(url.includes('oauth2.googleapis.com')) return {ok:true,json:async()=>({access_token:'test-access'})};
    return {ok:true,json:async()=>({id:'m1',threadId:'t1'})};
  };
  const result=await sendGmailReply({
    to:'player@example.com',subject:'Re: TrainingBot',body:'Xin chào bạn.'
  },{
    env:{GMAIL_CLIENT_ID:'id',GMAIL_CLIENT_SECRET:'secret',GMAIL_REFRESH_TOKEN:'refresh',GMAIL_FROM:'trainingbot.ai2@gmail.com'},
    fetchImpl
  });
  assert.equal(result.sent,true);
  assert.equal(calls.length,2);
  assert.match(calls[1].opts.headers.authorization,/^Bearer /);
  assert.equal(calls[1].opts.body.includes('secret'),false);
});

test('Facebook comment and Messenger connectors use Page access token without logging it',async()=>{
  const urls=[];
  const fetchImpl=async(url)=>{ urls.push(url); return {ok:true,json:async()=>({id:'x',message_id:'m',recipient_id:'u'})}; };
  const env={META_PAGE_ACCESS_TOKEN:'page-token',META_PAGE_ID:'123',META_GRAPH_VERSION:'v25.0'};
  const c=await replyFacebookComment({comment_id:'456',body:'Cảm ơn bạn.'},{env,fetchImpl});
  const m=await replyFacebookMessenger({recipient_id:'789',body:'Xin chào.'},{env,fetchImpl});
  assert.equal(c.sent,true);
  assert.equal(m.sent,true);
  assert.equal(urls.some(u=>u.includes('page-token')),false);
});

test('Discord connector replies in the same channel and caps message length',async()=>{
  let body='';
  const fetchImpl=async(url,opts)=>{ body=opts.body; return {ok:true,json:async()=>({id:'d1',channel_id:'c1'})}; };
  const r=await sendDiscordChannelReply({
    channel_id:'c1',
    body:'a'.repeat(2500),
    reply_to_message_id:'m0'
  },{
    env:{DISCORD_BOT_TOKEN:'bot-token'},
    fetchImpl
  });
  assert.equal(r.sent,true);
  assert.equal(JSON.parse(body).content.length,2000);
});
