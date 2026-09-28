export function normalize(value){
  return String(value ?? '').trim().toLowerCase();
}

export function isSensitive(text){
  const s=normalize(text);
  return [
    /refund|hoàn tiền/,
    /payment|thanh toán|billing/,
    /legal|pháp lý|lawyer/,
    /hack|hacked|xâm nhập|bị chiếm/,
    /password|mật khẩu/,
    /credential|api key|token|secret/,
    /delete (my )?(account|data)|xóa (tài khoản|dữ liệu)/,
    /bank|ngân hàng|credit card|thẻ tín dụng/,
    /personal data|dữ liệu cá nhân/
  ].some(r=>r.test(s));
}

export function looksLikeQuestion(text,botUsername=''){
  const raw=String(text ?? '').trim();
  const s=normalize(raw);
  if(!raw) return false;
  if(botUsername && s.includes('@'+normalize(botUsername))) return true;
  if(/[?？]$/.test(raw)) return true;
  return /^(cho mình hỏi|cho tôi hỏi|hỏi |làm sao|cách |tại sao|vì sao|ở đâu|khi nào|bao giờ|có |được không|mình muốn biết|ai biết|help|how |what |why |where |when |can |does |is )/i.test(s);
}

export function shouldIgnoreTelegramMessage(message,botId=''){
  if(!message || !message.message_id) return true;
  if(message.from?.is_bot) return true;
  if(botId && String(message.from?.id||'')===String(botId)) return true;
  if(!String(message.text||message.caption||'').trim()) return true;
  return false;
}

export function safeReplyText(value){
  const text=String(value||'').replace(/@everyone|@here/gi,'').trim();
  if(!text) return '';
  const sentences=text.split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(Boolean);
  const seen=new Set();
  const kept=[];
  for(const sentence of sentences){
    const key=sentence.toLowerCase().replace(/\s+/g,' ');
    if(seen.has(key)) continue;
    seen.add(key);
    kept.push(sentence);
    if(kept.join(' ').length>3000) break;
  }
  return kept.join(' ').slice(0,3800).trim();
}

export function hardGate(message,{botId='',botUsername=''}={}){
  if(shouldIgnoreTelegramMessage(message,botId)) return {decision:'IGNORE',reason:'bot/empty'};
  const content=String(message.text||message.caption||'');
  if(isSensitive(content)) return {decision:'ESCALATE',reason:'sensitive'};
  if(!looksLikeQuestion(content,botUsername)) return {decision:'IGNORE',reason:'not-a-question'};
  return {decision:'CLASSIFY',reason:'candidate-question'};
}

export function applyAiGate(ai){
  const classification=String(ai?.classification||'UNCERTAIN_OR_SENSITIVE');
  const confidence=Math.max(0,Math.min(1,Number(ai?.confidence)||0));
  const reply=safeReplyText(ai?.proposed_reply);
  if(classification!=='USER_GAME_OR_TRAININGBOT_QUESTION') return {decision:'NO_REPLY',confidence,reply:''};
  if(confidence<0.90 || !reply) return {decision:'NO_REPLY',confidence,reply};
  return {decision:'AUTO_REPLY',confidence,reply};
}

export function dateKey(date=new Date()){
  return date.toISOString().slice(0,10);
}
