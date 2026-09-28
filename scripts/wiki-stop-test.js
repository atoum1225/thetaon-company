// 위키 저장안 도중 멈춤 시험(가짜 AI 서버 4101, MOCK_DELAY=3000, WIKI_DIR=사본): node scripts/wiki-stop-test.js
const B = 'http://127.0.0.1:4101';
const { query, pool } = require('../src/db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (u, body) => fetch(B + u, { method: 'POST', body: body && new URLSearchParams(body), redirect: 'manual' });
const say = (task, body) => fetch(`${B}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, body }) });

(async () => {
  const r = await post('/tasks', { instruction: '위키 멈춤 시험' });
  const id = Number(r.headers.get('location').replace(/\D/g, ''));
  for (let i = 0; i < 40; i++) { if ((await query('SELECT status FROM tasks WHERE id=$1', [id])).rows[0].status === '승인대기') break; await sleep(1000); }
  await post(`/tasks/${id}/approve`);
  for (let i = 0; i < 90; i++) { if ((await query('SELECT status FROM tasks WHERE id=$1', [id])).rows[0].status === '완료') break; await sleep(1000); }
  console.log('완료됨, 위키 저장안 요청');

  await post(`/tasks/${id}/wiki/draft`);
  await sleep(1000);
  await say(id, '멈춰');
  await say(id, '보고서 요약 한 줄만 말해 줘');
  await sleep(9000);
  const t = (await query('SELECT wiki_draft IS NOT NULL AS has_draft FROM tasks WHERE id=$1', [id])).rows[0];
  console.log('저장안 남아 있음:', t.has_draft, '(false여야 맞음)');
  const m = await query(`SELECT kind, speaker, handled, left(body, 70) b FROM messages WHERE task_id=$1 AND id > (SELECT max(id) - 5 FROM messages WHERE task_id=$1) ORDER BY id`, [id]);
  m.rows.forEach((x) => console.log(' ', x.kind, x.speaker, x.handled ? '' : '(미처리)', '|', x.b));
  await pool.end();
})();
