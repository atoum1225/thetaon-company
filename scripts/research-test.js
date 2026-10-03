// 쫑전략 외부 자료 조사 시험(가짜 AI 서버가 4101에 떠 있어야 함): node scripts/research-test.js
// 세 경로를 본다: 검색만 / 대표님이 원문 확인 켬 / 김비서가 원문 확인 요청.
const B = 'http://127.0.0.1:4101';
const { query, pool } = require('../src/db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (label, ok) => { console.log(ok ? '  통과' : '  실패', label); if (!ok) bad++; };

async function create(instruction, research) {
  const body = new URLSearchParams({ instruction });
  if (research) body.set('research', '1');
  const r = await fetch(`${B}/tasks`, { method: 'POST', body, redirect: 'manual' });
  return Number(r.headers.get('location').replace(/\D/g, ''));
}
async function waitStatus(id, want, ms = 30000) {
  for (let i = 0; i < ms / 300; i++) {
    const s = (await query('SELECT status FROM tasks WHERE id=$1', [id])).rows[0].status;
    if (s === want) return true;
    await sleep(300);
  }
  return false;
}
async function finish(id) {
  if (!(await waitStatus(id, '승인대기'))) return false;
  await fetch(`${B}/tasks/${id}/approve`, { method: 'POST', redirect: 'manual' });
  return waitStatus(id, '완료');
}
const rows = async (id) => (await query('SELECT purpose, trusted, opened FROM external_sources WHERE task_id=$1 ORDER BY id', [id])).rows;
const task = async (id) => (await query('SELECT research, research_by, final_report FROM tasks WHERE id=$1', [id])).rows[0];

(async () => {
  const a = await create('외부 자료 시험: 검색만', false);
  const b = await create('외부 자료 시험: 대표님이 원문 확인 켬', true);
  const c = await create('외부 자료 시험: 원문 확인 시험', false);
  console.log(`업무 #${a}(검색만) #${b}(대표님 켬) #${c}(김비서 요청)`);
  check('#a 완료', await finish(a));
  check('#b 완료', await finish(b));
  check('#c 완료', await finish(c));

  const ra = await rows(a);
  check(`검색만: 회의 첫 발언·산출물 조언에서 자료 저장 (${ra.map((x) => x.purpose).join(',')})`, ra.some((x) => x.purpose === 'advise_meeting') && ra.some((x) => x.purpose === 'advise'));
  check('검색만: 원문 연 자료 없음', ra.every((x) => !x.opened));
  check('목록 밖 자료는 신뢰 목록 밖으로 표시', ra.some((x) => !x.trusted) && ra.some((x) => x.trusted));
  check('#b 대표님 켬: research=true, CEO', (await task(b)).research && (await task(b)).research_by === 'CEO');
  check('#b 원문 확인한 자료 있음', (await rows(b)).some((x) => x.opened));
  const tc = await task(c);
  check(`#c 김비서 요청: research=true, ${tc.research_by}`, tc.research && tc.research_by === '김비서');
  check('#c 원문 확인한 자료 있음', (await rows(c)).some((x) => x.opened));
  const msg = (await query(`SELECT body FROM messages WHERE task_id=$1 AND speaker='쫑전략' ORDER BY id LIMIT 1`, [a])).rows[0];
  check('회의 발언에 참고 자료 목록이 붙음', /참고한 외부 자료/.test(msg?.body || ''));
  const page = await (await fetch(`${B}/tasks/${a}`)).text();
  check('업무 화면에 외부 자료 표가 보임', page.includes('시험 통계 자료') && page.includes('신뢰 목록 밖'));

  // 대표님이 켜고 끄기
  const d = await create('외부 자료 시험: 켜고 끄기', false);
  await fetch(`${B}/tasks/${d}/research`, { method: 'POST', body: new URLSearchParams({ on: '1' }), redirect: 'manual' });
  check('켜기 버튼', (await task(d)).research === true);
  await fetch(`${B}/tasks/${d}/research`, { method: 'POST', body: new URLSearchParams({ on: '0' }), redirect: 'manual' });
  const td = await task(d);
  check('끄기 버튼(대표님이 끈 것은 김비서가 다시 켜지 않음 표시)', td.research === false && td.research_by === 'CEO');

  console.log(bad ? `실패 ${bad}건` : '모두 통과');
  await pool.end();
  process.exit(bad ? 1 : 0);
})();
