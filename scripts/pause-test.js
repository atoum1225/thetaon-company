// 멈춤·재개 시험(가짜 AI 서버가 4101에 떠 있어야 함): node scripts/pause-test.js
const B = 'http://127.0.0.1:4101';
const { query, pool } = require('../src/db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = async (id) => (await query('SELECT status, paused_status, step FROM tasks WHERE id=$1', [id])).rows[0];
const say = (task, body) => fetch(`${B}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, body }) });

(async () => {
  const r = await fetch(`${B}/tasks`, { method: 'POST', body: new URLSearchParams({ instruction: '멈춤 재개 시험' }), redirect: 'manual' });
  const id = Number(r.headers.get('location').replace(/\D/g, ''));
  await sleep(4500); // 과제 정의 한 번 끝나고 다음 호출 중
  await say(id, '멈춰');
  await sleep(300);
  console.log('멈춰 직후 0.3초:', await status(id));
  await sleep(4000); // 하던 호출이 끝나도 멈춰 있어야 함
  console.log('4초 뒤(하던 호출 끝남):', await status(id));
  await say(id, '다시 진행');
  await sleep(300);
  console.log('"다시 진행" 직후:', await status(id));
  await sleep(20000);
  console.log('20초 뒤:', await status(id));
  const m = await query(`SELECT kind, speaker, left(body, 60) b FROM messages WHERE task_id=$1 ORDER BY id`, [id]);
  m.rows.forEach((x) => console.log(' ', x.kind, x.speaker, '|', x.b));
  await pool.end();
})();
