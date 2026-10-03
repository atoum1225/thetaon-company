// 휴지통 시험(가짜 AI 서버가 4101에 떠 있어야 함): node scripts/trash-test.js
const B = 'http://127.0.0.1:4101';
const { query, pool } = require('../src/db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = async (id) => (await query('SELECT status, paused_status, step, deleted_at FROM tasks WHERE id=$1', [id])).rows[0];
const say = (task, body) => fetch(`${B}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, body }) });
const post = (path) => fetch(`${B}${path}`, { method: 'POST', redirect: 'manual' });
const listHas = async (path, id) => (await (await fetch(`${B}${path}`)).text()).includes(`href="/tasks/${id}"`);
let bad = 0;
const check = (label, ok) => { console.log(ok ? '  통과' : '  실패', label); if (!ok) bad++; };

(async () => {
  const r = await fetch(`${B}/tasks`, { method: 'POST', body: new URLSearchParams({ instruction: '휴지통 시험' }), redirect: 'manual' });
  const id = Number(r.headers.get('location').replace(/\D/g, ''));
  console.log(`업무 #${id}`);

  await post(`/tasks/${id}/delete`);
  check('진행 중 업무는 지울 수 없음', (await status(id)).status !== '삭제됨');

  await sleep(4500); // 과제 정의 한 번 끝나고 다음 호출 중
  await say(id, '멈춰');
  await sleep(300);
  await post(`/tasks/${id}/delete`);
  check('일시정지 업무를 지움', (await status(id)).status === '삭제됨');
  await sleep(4000); // 하던 호출이 끝나도 되살아나지 않아야 함
  const s1 = await status(id);
  check(`하던 호출이 끝나도 삭제됨 유지 (${s1.status})`, s1.status === '삭제됨');
  check('전체 목록에서 빠짐', !(await listHas('/tasks', id)));
  check('휴지통 목록에 있음', await listHas('/tasks?group=trash', id));
  const chat = await say(id, '이거 어떻게 됐어?');
  check('휴지통 업무에는 말을 걸 수 없음', !chat.ok);

  await post(`/tasks/${id}/restore`);
  const s2 = await status(id);
  check(`되살리면 일시정지 (${s2.status}, 이어갈 상태 ${s2.paused_status})`, s2.status === '일시정지' && s2.paused_status && !s2.deleted_at);
  check('확인 필요 목록에 다시 보임', await listHas('/tasks?group=trouble', id));

  await say(id, '다시 진행');
  await sleep(300);
  const s3 = await status(id);
  check(`"다시 진행"으로 이어서 함 (${s3.status})`, !['일시정지', '삭제됨'].includes(s3.status));

  await say(id, '멈춰'); // 시험 업무를 멈춰 둔다
  console.log(bad ? `실패 ${bad}건` : '모두 통과');
  await pool.end();
  process.exit(bad ? 1 : 0);
})();
