import test from 'node:test';
import assert from 'node:assert/strict';
import { hardGate, applyAiGate, safeReplyText, looksLikeQuestion } from '../src/core.mjs';

test('ignores bot messages to prevent loops',()=>{
  const r=hardGate({id:'1',content:'TrainingBot là gì?',author:{id:'bot',bot:true}},{botUserId:'bot'});
  assert.equal(r.decision,'IGNORE');
});

test('sensitive request escalates and is not auto replied',()=>{
  const r=hardGate({id:'2',content:'Tài khoản tôi bị hack và muốn đổi mật khẩu?',author:{id:'u',bot:false}});
  assert.equal(r.decision,'ESCALATE');
});

test('ordinary question becomes AI candidate',()=>{
  const r=hardGate({id:'3',content:'Cho mình hỏi bản cập nhật mới ở đâu?',author:{id:'u',bot:false}});
  assert.equal(r.decision,'CLASSIFY');
});

test('high-confidence classification may auto reply',()=>{
  const r=applyAiGate({
    classification:'USER_GAME_OR_TRAININGBOT_QUESTION',
    confidence:0.97,
    proposed_reply:'Bạn có thể xem mục Bản cập nhật trên TrainingBot.'
  });
  assert.equal(r.decision,'AUTO_REPLY');
});

test('low-confidence AI never sends automatically',()=>{
  const r=applyAiGate({
    classification:'USER_GAME_OR_TRAININGBOT_QUESTION',
    confidence:0.75,
    proposed_reply:'Có thể là như vậy.'
  });
  assert.equal(r.decision,'NO_REPLY');
});

test('mentions and obvious question forms are detected',()=>{
  assert.equal(looksLikeQuestion('<@123> giúp mình với','123'),true);
  assert.equal(looksLikeQuestion('Làm sao tải bản mới?',''),true);
  assert.equal(looksLikeQuestion('chào mọi người',''),false);
});

test('reply sanitizer strips broadcast mentions and duplicates',()=>{
  assert.equal(
    safeReplyText('@everyone Xin chào. Xin chào. Xem trang wiki nhé.'),
    'Xin chào. Xem trang wiki nhé.'
  );
});
