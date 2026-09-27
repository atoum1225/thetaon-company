// 금지 수치 검사 시험: node scripts/rules-test.js
const rules = require('../src/rules');
const { pool } = require('../src/db');

const cases = [
  ['세타로는 GPU 전력을 64% 절감합니다.', true],
  ['GPU 전력 절감 25 ~ 63%', true],
  ['토큰 절감 −22.7%', true],
  ['인텔 AI PC 평균 전력 −32%', true],
  ['NPU 868× 효율', true],
  ['품질 BERT Score 0.98', true],
  ['서버 전력 절감 효과', true],
  ['토큰당 에너지 −22.7%(J/tok, GPU 소켓 기준, H200×4·72B)', false],
  ['Ollama 대비 에너지 효율 26.8×', false],
  ['다올TS θ vs vLLM 에너지 −16.73%', false],
  ['| p12 | ~~GPU 전력 -64%~~ | 토큰당 에너지 −22.7%(J/tok) |', false],
  ['| p13 | ~~GPU 전력 절감 25 ~ 63%~~ | 삭제 | 그런데 본문에 64% 절감', true],
  ['Intel 품질 BERTScore 0.972', false],
];

(async () => {
  let bad = 0;
  for (const [text, expectForbidden] of cases) {
    const hits = await rules.scan(text);
    const forb = hits.filter((h) => h.level === 'forbidden');
    const ok = expectForbidden === forb.length > 0;
    if (!ok) bad++;
    console.log(ok ? '맞음' : '틀림', '|', text, '|', hits.map((h) => `${h.level === 'forbidden' ? '금지' : '조건'}:${h.key}`).join(', ') || '-');
  }
  console.log(bad ? `틀린 경우 ${bad}건` : '모두 맞음');
  await pool.end();
  process.exit(bad ? 1 : 0);
})();
