// AI 연결 시험: node scripts/ai-smoke.js [claude|gemini]
const { callClaude, callGemini } = require('../src/ai');

const schema = {
  type: 'object',
  properties: { answer: { type: 'string' }, doc: { type: 'string' } },
  required: ['answer', 'doc'],
};
const prompts = {
  claude: "C:\\ThetaRO\\index.md 를 읽고 '세타로'가 무엇인지 한 문장으로 answer에, 근거 문서 이름을 doc에 적어 JSON으로 답해줘.",
  gemini: '다음 문장에 대외 금지 수치 위험이 있는지 answer에 한두 문장으로, 문제 표현을 doc에 적어라: "세타로는 GPU 전력을 64% 절감합니다."',
};

(async () => {
  const which = process.argv[2] || 'claude';
  const t = Date.now();
  const fn = which === 'gemini' ? callGemini : callClaude;
  const r = await fn({ system: '너는 세타온 직원이다. 짧게 답한다.', prompt: prompts[which], schema });
  console.log(which, ((Date.now() - t) / 1000).toFixed(1) + 's', JSON.stringify(r.json), r.usage);
  if (!r.json) console.log('원문:', r.text);
})().catch((e) => { console.error('실패:', e.message, e.limit ? '(한도)' : ''); process.exit(1); });
