import test from 'node:test';
import assert from 'node:assert/strict';
import { hardGate, applyAiGate, safeReplyText, looksLikeQuestion } from '../src/core.mjs';

test('ignores Telegram bot messages',()=>{
  const r=hardGate({message_id:1,text:'TrainingBot là gì?',from:{id:10,is_bot:true}});
  assert.equal(r.decision,'IGNORE');
});

test('sensitive Telegram request escalates',()=>{
  const r=hardGate({message_id:2,text:'Tài khoản tôi bị hack và muốn đổi mật khẩu?',from:{id:11,is_bot:false}});
  assert.equal(r.decision,'ESCALATE');
});

test('ordinary Telegram question becomes AI candidate',()=>{
  const r=hardGate({message_id:3,text:'Cho mình hỏi mục Wiki ở đâu?',from:{id:12,is_bot:false}});
  assert.equal(r.decision,'CLASSIFY');
});

test('high confidence may auto reply',()=>{
  const r=applyAiGate({
    classification:'USER_GAME_OR_TRAININGBOT_QUESTION',
    confidence:0.97,
    proposed_reply:'Bạn có thể xem mục Wiki trên TrainingBot.'
  });
  assert.equal(r.decision,'AUTO_REPLY');
});

test('low confidence never sends automatically',()=>{
  const r=applyAiGate({
    classification:'USER_GAME_OR_TRAININGBOT_QUESTION',
    confidence:0.72,
    proposed_reply:'Có thể là như vậy.'
  });
  assert.equal(r.decision,'NO_REPLY');
});

test('mention or question form is detected',()=>{
  assert.equal(looksLikeQuestion('@TrainingBotCommsBot giúp mình với','TrainingBotCommsBot'),true);
  assert.equal(looksLikeQuestion('Làm sao xem Wiki?',''),true);
  assert.equal(looksLikeQuestion('chào mọi người',''),false);
});

test('reply sanitizer de-duplicates',()=>{
  assert.equal(safeReplyText('Xin chào. Xin chào. Xem Wiki nhé.'),'Xin chào. Xem Wiki nhé.');
});
