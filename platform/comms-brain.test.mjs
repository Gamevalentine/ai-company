import test from 'node:test';
import assert from 'node:assert/strict';
import { hardClassify, applyCommsGate, processInboundMessage, routeForSource } from './comms-brain.mjs';

function mockFetch(reply){
  return async()=>({
    ok:true,
    json:async()=>({model:'comms-test-model',message:{content:JSON.stringify(reply)}}),
    text:async()=>''
  });
}

test('website support replies through TrainingBot Gmail',()=>{
  const r=routeForSource('trainingbot.io.vn');
  assert.equal(r.reply_channel,'gmail');
  assert.equal(r.reply_identity,'trainingbot.ai2@gmail.com');
});

test('Facebook and Telegram stay on the same channel',()=>{
  assert.equal(routeForSource('facebook_comment').reply_channel,'facebook_comment_thread');
  assert.equal(routeForSource('facebook_messenger').reply_channel,'facebook_messenger');
  assert.equal(routeForSource('telegram_community').reply_channel,'same_telegram_chat');
});

test('noreply and verification messages are ignored before AI',()=>{
  const r=hardClassify({
    source:'email',
    sender:'no-reply@example.com',
    subject:'Mã xác minh của bạn',
    body:'Your verification code is 123456'
  });
  assert.equal(r.forced_classification,'ACCOUNT_OR_SYSTEM_NOTIFICATION');
  assert.equal(r.forced_decision,'IGNORE_NOTIFICATION');
});

test('sensitive support requests escalate before AI',()=>{
  const r=hardClassify({
    source:'facebook_messenger',
    sender:'user',
    body:'Tôi muốn hoàn tiền và đổi mật khẩu tài khoản'
  });
  assert.equal(r.forced_classification,'UNCERTAIN_OR_SENSITIVE');
  assert.equal(r.forced_decision,'ESCALATE');
});

test('high confidence approved game question may auto reply',()=>{
  const r=applyCommsGate({
    classification:'USER_GAME_OR_TRAININGBOT_QUESTION',
    confidence:0.96,
    proposed_reply:'Bạn có thể xem thông tin đã công bố tại trang cập nhật.',
    sensitive_flags:[]
  },{
    source:'telegram_community',
    approved_context:'Thông tin công khai đã được duyệt: xem trang cập nhật TrainingBot.'
  });
  assert.equal(r.decision,'AUTO_REPLY');
  assert.equal(r.route.reply_channel,'same_telegram_chat');
});

test('missing approved context keeps a high confidence answer as draft only',()=>{
  const r=applyCommsGate({
    classification:'USER_GAME_OR_TRAININGBOT_QUESTION',
    confidence:0.99,
    proposed_reply:'Draft',
    sensitive_flags:[]
  },{
    source:'facebook_comment',
    approved_context:''
  });
  assert.equal(r.decision,'DRAFT_ONLY');
});

test('hard filters skip model call entirely',async()=>{
  let called=false;
  const r=await processInboundMessage({
    source:'email',
    sender:'noreply@service.example',
    subject:'Security alert',
    body:'New sign-in'
  },{
    fetchImpl:async()=>{ called=true; throw new Error('should not run'); }
  });
  assert.equal(called,false);
  assert.equal(r.decision,'IGNORE_NOTIFICATION');
  assert.equal(r.external_send_performed,false);
});

test('AI classification is still constrained by confidence threshold',async()=>{
  const r=await processInboundMessage({
    source:'trainingbot.io.vn',
    sender:'player@example.com',
    subject:'Hỏi về game',
    body:'Cho mình hỏi bản cập nhật mới?',
    approved_context:'TrainingBot chỉ trả lời dựa trên nội dung đã công bố.'
  },{
    fetchImpl:mockFetch({
      classification:'USER_GAME_OR_TRAININGBOT_QUESTION',
      confidence:0.75,
      intent:'ask_update',
      reason:'User asks about a game update',
      proposed_reply:'Mình đã nhận câu hỏi và đang kiểm tra thông tin đã công bố.',
      sensitive_flags:[]
    })
  });
  assert.equal(r.decision,'DRAFT_ONLY');
  assert.equal(r.route.reply_identity,'trainingbot.ai2@gmail.com');
});


test('COMMS removes repeated reply sentences',()=>{
  const r=applyCommsGate({
    classification:'USER_GAME_OR_TRAININGBOT_QUESTION',
    confidence:0.95,
    proposed_reply:'Xin chào bạn. Xin chào bạn. Đây là câu trả lời.',
    sensitive_flags:[]
  },{
    source:'trainingbot.io.vn',
    approved_context:'Thông tin công khai đã được duyệt.'
  });
  assert.equal(r.decision,'AUTO_REPLY');
  assert.equal(r.proposed_reply,'Xin chào bạn. Đây là câu trả lời.');
});
