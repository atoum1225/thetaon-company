// 쫑전략 Gemini 한도 → Claude 대체 시험.
// 가짜 AI 서버를 MOCK_GEMINI_LIMIT=1로 4101에 띄운 뒤: node scripts/fallback-test.js
const B = 'http://127.0.0.1:4101';
const { query, pool } = require('../src/db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (label, ok) => { console.log(ok ? '  통과' : '  실패', label); if (!ok) bad++; };

async function waitStatus(id, want, ms = 30000) {
  for (let i = 0; i < ms / 300; i++) {
    const s = (await query('SELECT status FROM tasks WHERE id=$1', [id])).rows[0].status;
    if (s === want) return true;
    await sleep(300);
  }
  return false;
}

(async () => {
  const r = await fetch(`${B}/tasks`, { method: 'POST', body: new URLSearchParams({ instruction: '대체 시험: 쫑전략 한도' }), redirect: 'manual' });
  const id = Number(r.headers.get('location').replace(/\D/g, ''));
  console.log(`업무 #${id}`);
  check('한도에도 회의가 멈추지 않고 승인 대기까지', await waitStatus(id, '승인대기'));
  await fetch(`${B}/tasks/${id}/approve`, { method: 'POST', redirect: 'manual' });
  check('완료까지 진행', await waitStatus(id, '완료'));

  const msgs = (await query(`SELECT body FROM messages WHERE task_id=$1 AND speaker='쫑전략' ORDER BY id`, [id])).rows;
  check(`쫑전략 발언·조언 모두 대체 표시 (${msgs.length}건)`, msgs.length >= 2 && msgs.every((m) => m.body.includes('Claude가 쫑전략 대신')));
  const calls = (await query(
    `SELECT u.provider, u.model, u.ok FROM ai_usage u JOIN employees e ON e.id=u.employee_id WHERE u.task_id=$1 AND e.name='쫑전략' ORDER BY u.id`, [id])).rows;
  const fails = calls.filter((c) => !c.ok);
  const subs = calls.filter((c) => c.ok && /대체/.test(c.model));
  console.log('  쫑전략 호출:', calls.map((c) => `${c.provider}/${c.model}/${c.ok ? '성공' : '실패'}`).join(', '));
  check('대체 호출이 장부에 "대체"로 남음', subs.length >= 2);
  check('한도 확인 뒤에는 Gemini를 다시 부르지 않음(실패는 많아야 1건)', fails.length <= 1);

  console.log(bad ? `실패 ${bad}건` : '모두 통과');
  await pool.end();
  process.exit(bad ? 1 : 0);
})();
