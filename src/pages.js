// 업무 사이트 화면들.
const express = require('express');
const { query, safeMessage } = require('./db');
const { layout, esc, badge } = require('./views');
const engine = require('./engine');
const memory = require('./memory');
const rules = require('./rules');
const wiki = require('./wiki');
const report = require('./report');

const router = express.Router();
const STEP_NAMES = ['', '① 접수', '② 과제 정의', '③ 회의 소집', '④ 토론', '⑤ 회의록·배정안', '⑥ CEO 승인 대기', '⑦ 담당자 수행', '⑧ 김비서 검수', '⑨ 전략 조언', '⑩ 최종 보고', '완료'];
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku'];
const GEMINI_MODELS = ['gemini-3.1-pro-high', 'gemini-3.1-pro-low', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium'];

const fmt = (d) => (d ? new Date(d).toLocaleString('ko-KR', { hour12: false }) : '');
const doc = (s) => `<pre class="doc">${esc(s)}</pre>`;
const back = (res, url, msg) => res.redirect(`${url}${url.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}`);
const notice = (req) => (req.query.msg ? `<div class="card notice">${esc(req.query.msg)}</div>` : '');

function chatPanel(taskId, title) {
  return `
  <div class="card chat" data-task="${taskId ?? ''}">
    <div class="chat-head">메신저 <span class="muted">${esc(title)}</span> <span class="live muted">연결 중…</span></div>
    <div class="chat-log"></div>
    <div class="working" data-task="${taskId ?? ''}" hidden></div>
    <form class="chat-form">
      <input type="text" name="body" placeholder="대표님 말씀을 입력하세요 (멈추려면 '멈춰')" autocomplete="off">
      <button>보내기</button>
    </form>
  </div>`;
}

// ───── 본부(첫 화면) ─────
router.get('/', async (req, res) => {
  let dbLine;
  let counts = '';
  let recent = '';
  try {
    const v = await query('SELECT version() AS v');
    dbLine = `<span class="ok">DB 연결됨</span> <span class="muted">${esc(v.rows[0].v.split(',')[0])}</span>`;
    const c = await query('SELECT status, count(*)::int AS n FROM tasks GROUP BY status');
    counts = c.rows.map((x) => `${badge(x.status)} ${x.n}건`).join(' &nbsp; ') || '<span class="muted">아직 업무가 없습니다.</span>';
    const r = await query('SELECT id, title, status, updated_at FROM tasks ORDER BY updated_at DESC LIMIT 8');
    recent = r.rows.map((t) => `<tr><td>#${t.id}</td><td><a href="/tasks/${t.id}">${esc(t.title)}</a></td><td>${badge(t.status)}</td><td class="muted">${fmt(t.updated_at)}</td></tr>`).join('');
  } catch (err) {
    dbLine = `<span class="bad">DB 연결 안 됨</span> ${esc(safeMessage(err))}`;
  }
  const st = engine.state();
  res.send(layout('본부', `
    ${notice(req)}
    <h1>세타온 본부</h1>
    <div class="card" data-live="engine">${dbLine} &nbsp;·&nbsp; 진행기: ${st.busy ? `<b>업무 #${st.current ?? '-'} 처리 중</b>` : '대기 중'}${st.queued ? `, 대기 ${st.queued}건` : ''}${process.env.AI_MOCK === '1' ? ' &nbsp;<span class="bad">[가짜 AI 시험 모드]</span>' : ''}</div>
    <div class="card">
      <h2 style="margin-top:0">김비서에게 업무 지시</h2>
      <form method="post" action="/tasks">
        <textarea name="instruction" placeholder="예: 비이랩 4차 미팅 결과를 바탕으로 KT 카탈로그 요금 설명 자료 초안을 만들어 줘. 마감 10/2." required></textarea>
        <p><button>지시하기</button> <span class="muted">지시하면 김비서가 과제를 정리하고 회의를 엽니다. 배정안이 나오면 승인을 요청드립니다.</span></p>
      </form>
    </div>
    <div class="card" data-live="counts">${counts}</div>
    <div class="row">
      <div data-live="recent"><h2>최근 업무</h2><table><tr><th>번호</th><th>업무</th><th>상태</th><th>갱신</th></tr>${recent || '<tr><td colspan="4" class="muted">없음</td></tr>'}</table></div>
      <div><h2>일반 대화</h2>${chatPanel(null, '업무와 무관한 대화 · 김비서가 답합니다')}</div>
    </div>
  `, { active: '/' }));
});

// ───── 업무 목록·지시 ─────
router.get('/tasks', async (req, res) => {
  const status = req.query.status || '';
  const r = await query(
    `SELECT id, title, status, step, deadline, reject_count, rework_count, created_at, updated_at FROM tasks
     WHERE ($1 = '' OR status = $1) ORDER BY id DESC LIMIT 200`, [status]);
  const tabs = ['', '접수', '회의중', '승인대기', '수행중', '검수중', '전략조언', '완료', '일시정지', '한도대기', '실패']
    .map((s) => `<a class="tab ${s === status ? 'on' : ''}" href="/tasks${s ? `?status=${encodeURIComponent(s)}` : ''}">${s || '전체'}</a>`).join(' ');
  const rows = r.rows.map((t) => `<tr><td>#${t.id}</td><td><a href="/tasks/${t.id}">${esc(t.title)}</a></td><td>${badge(t.status)}</td>
    <td class="muted">${STEP_NAMES[t.step] || ''}</td><td>${esc(t.deadline || '')}</td><td>${t.reject_count}/${t.rework_count}</td><td class="muted">${fmt(t.created_at)}</td></tr>`).join('');
  res.send(layout('업무', `${notice(req)}<h1>업무</h1><p>${tabs}</p>
    <table data-live="list"><tr><th>번호</th><th>업무</th><th>상태</th><th>단계</th><th>마감</th><th>반려/재작업</th><th>지시 시각</th></tr>${rows || '<tr><td colspan="7" class="muted">없음</td></tr>'}</table>`, { active: '/tasks' }));
});

router.post('/tasks', async (req, res) => {
  const instruction = String(req.body.instruction || '').trim();
  if (!instruction) return back(res, '/', '지시 내용을 입력해 주세요.');
  const id = await engine.createTask(instruction);
  res.redirect(`/tasks/${id}`);
});

// ───── 업무 상세 ─────
router.get('/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  const t = (await query('SELECT * FROM tasks WHERE id=$1', [id])).rows[0];
  if (!t) return res.status(404).send(layout('없음', '<h1>업무를 찾을 수 없습니다.</h1>'));
  const meetings = (await query('SELECT * FROM meetings WHERE task_id=$1 ORDER BY attempt', [id])).rows;
  const deliv = (await query(`SELECT v.*, e.name FROM deliverables v LEFT JOIN employees e ON e.id=v.employee_id WHERE task_id=$1 ORDER BY assignment_idx, version DESC`, [id])).rows;
  const advice = (await query('SELECT * FROM advice WHERE task_id=$1 ORDER BY id', [id])).rows;
  const events = (await query('SELECT * FROM task_events WHERE task_id=$1 ORDER BY id', [id])).rows;
  const decisions = (await query('SELECT * FROM decisions WHERE task_id=$1 ORDER BY id', [id])).rows;
  const usage = (await query('SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT ok)::int AS fails FROM ai_usage WHERE task_id=$1', [id])).rows[0];
  const d = t.definition || {};
  const last = meetings[meetings.length - 1];

  const controls = [];
  if (engine.PAUSABLE.includes(t.status)) controls.push(`<form method="post" action="/tasks/${id}/pause" class="inline"><button class="gray">일시정지</button></form>`);
  if (['일시정지', '한도대기', '실패'].includes(t.status)) controls.push(`<form method="post" action="/tasks/${id}/resume" class="inline"><button class="green">다시 진행</button></form>`);

  const approval = t.status === '승인대기' && last ? `
    <div class="card approve">
      <h2 style="margin-top:0">배정안 승인 요청 (${last.attempt}차 회의)</h2>
      ${planHtml(last)}
      <div class="row" style="margin-top:12px">
        <form method="post" action="/tasks/${id}/approve"><button class="green">승인하고 진행</button></form>
        <form method="post" action="/tasks/${id}/reject">
          <input type="text" name="reason" placeholder="반려 사유 (필수)" required>
          <p><button class="red">반려하고 재회의</button></p>
        </form>
      </div>
    </div>` : '';

  const meetingHtml = meetings.map((m) => `
    <details ${m === last ? 'open' : ''}><summary>${m.attempt}차 회의 · ${m.rounds}라운드 · 참석 ${esc(m.attendees.join(', '))}</summary>
      ${m.minutes ? `<h3>회의록</h3>${doc(m.minutes)}` : '<p class="muted">회의 진행 중입니다.</p>'}
      ${m.assignment_plan && m !== last ? planHtml(m) : ''}
    </details>`).join('') || '<p class="muted">아직 회의가 없습니다.</p>';

  const delivHtml = deliv.map((v) => `
    <details><summary>${esc(v.name || '')} · ${esc(v.title)} v${v.version} ${v.review_result ? `· 검수 <b class="${v.review_result === '통과' ? 'ok' : 'bad'}">${v.review_result}</b>` : '· 검수 전'}</summary>
      ${v.review_note ? `<p class="muted">검수 의견: ${esc(v.review_note)}</p>` : ''}
      ${hitsHtml(v.forbidden_hits)}
      ${doc(v.body)}
    </details>`).join('') || '<p class="muted">아직 산출물이 없습니다.</p>';

  const adviceHtml = advice.map((a) => `
    <div class="advice"><div class="muted">AI 조언(김종배 이사 관점 참고) · 참고 의견일 뿐 결정이 아닙니다</div>${doc(a.content)}
    <p><b>김비서 판단:</b> ${esc(a.adopted || '판단 전')} ${a.reason ? `— ${esc(a.reason)}` : ''}</p></div>`).join('') || '<p class="muted">아직 조언이 없습니다.</p>';

  res.send(layout(`업무 #${id}`, `
    ${notice(req)}
    <div data-live="top">
    <h1>#${id} ${esc(t.title)} ${badge(t.status)}</h1>
    <div class="card">
      <div class="steps">${stepsHtml(t)}</div>
      <p class="muted">마감: ${esc(t.deadline || d.deadline || '미정')} · 반려 ${t.reject_count}회 · 재작업 ${t.rework_count}회 · AI 호출 ${usage.n}회${usage.fails ? ` (실패 ${usage.fails})` : ''} · 지시 ${fmt(t.created_at)}</p>
      ${t.error ? `<p class="bad">${esc(t.error)}</p>` : ''}
      ${controls.join(' ')}
    </div>
    ${approval}
    </div>
    <div class="row wide">
      <div data-live="left">
        <div class="card"><h2 style="margin-top:0">지시와 과제 정의</h2>
          <p><b>CEO 지시:</b> ${esc(t.instruction)}</p>
          ${d.goal ? `<p><b>목표:</b> ${esc(d.goal)}</p><p><b>범위:</b> ${esc(d.scope)}</p><p><b>참석:</b> ${esc((d.attendees || []).join(', '))}, 쫑전략(조언자)</p>` : ''}
          ${d.references?.length ? `<p><b>참고한 과거 기록:</b> ${esc(d.references.join(', '))}</p>` : ''}
          ${d.conflicts?.length ? `<p class="bad">이전 결정과 다를 수 있는 점: ${esc(d.conflicts.join(' / '))}</p>` : ''}
        </div>
        ${t.final_report ? `<div class="card report"><h2 style="margin-top:0">최종 보고서</h2>
          <p><a class="btn" href="/tasks/${id}/report" target="_blank">HTML 보고서 보기</a> <a class="btn gray" href="/tasks/${id}/report?download=1">HTML 파일로 받기</a></p>
          ${doc(t.final_report)}</div>` : ''}
        ${t.status === '완료' ? wikiHtml(t) : ''}
        <div class="card"><h2 style="margin-top:0">회의록</h2>${meetingHtml}</div>
        ${decisions.length ? `<div class="card"><h2 style="margin-top:0">확정된 결정사항</h2><ol>${decisions.map((x) => `<li>${esc(x.content)} <span class="muted">(${esc(x.decided_by)})</span></li>`).join('')}</ol></div>` : ''}
        <div class="card"><h2 style="margin-top:0">산출물</h2>${delivHtml}</div>
        <div class="card"><h2 style="margin-top:0">쫑전략 조언</h2>${adviceHtml}</div>
        <div class="card"><h2 style="margin-top:0">진행 기록</h2><table>${events.map((e) => `<tr><td class="muted">${fmt(e.created_at)}</td><td>${esc(e.kind)}</td><td>${esc(e.actor)}</td><td>${esc(e.detail || '')}</td></tr>`).join('')}</table></div>
      </div>
      <div>${chatPanel(id, `업무 #${id}`)}</div>
    </div>
  `, { active: '/tasks' }));
});

function wikiHtml(t) {
  const id = t.id;
  if (t.wiki_path) {
    return `<div class="card"><h2 style="margin-top:0">위키 저장</h2><p class="ok">저장했습니다: ${esc(t.wiki_path)}</p>
      <p class="muted">${fmt(t.wiki_saved_at)} · index.md와 log.md에도 한 줄씩 추가했습니다. 옵시디언에서 바로 보입니다.</p></div>`;
  }
  const d = t.wiki_draft;
  if (!d) {
    return `<div class="card"><h2 style="margin-top:0">위키 저장</h2>
      <p class="muted">이 업무 결과를 C:\\ThetaRO 위키에 남길지 김비서가 위키 규칙(저장 필터·분류·파일 이름)에 맞춰 저장안을 먼저 만듭니다. 대표님이 확인하고 저장을 눌러야 실제로 저장됩니다.</p>
      <form method="post" action="/tasks/${id}/wiki/draft"><button>위키 저장안 만들기</button></form></div>`;
  }
  const cat = wiki.CATEGORIES[d.category] || {};
  return `<div class="card approve"><h2 style="margin-top:0">위키 저장안 확인</h2>
    ${d.save ? '' : `<p class="bad">김비서 판단: 저장 필터를 통과하지 못합니다. ${esc(d.not_save_reason)}</p>`}
    <table>
      <tr><th>저장 위치</th><td>AI-Sessions/wiki/${esc(cat.dir || '')}/<b>${esc(d.name)}.md</b> (${esc(cat.name || '')}, ${d.status === 'draft' ? '초안' : '확정'})</td></tr>
      <tr><th>index.md 한 줄 요약</th><td>${esc(d.summary)}</td></tr>
      <tr><th>통과한 저장 필터</th><td>${esc((d.filter_reasons || []).join(' / ') || '-')}</td></tr>
      <tr><th>연결 문서</th><td>${esc((d.links || []).join(', ') || '-')}</td></tr>
    </table>
    <details open><summary>문서 본문 미리보기</summary>${doc(wiki.fileText(d, t))}</details>
    <div class="row" style="margin-top:12px">
      ${d.save ? `<form method="post" action="/tasks/${id}/wiki/save"><button class="green">위키에 저장</button></form>` : ''}
      <form method="post" action="/tasks/${id}/wiki/draft"><button class="gray">저장안 다시 만들기</button></form>
      <form method="post" action="/tasks/${id}/wiki/discard"><button class="gray">저장 안 함</button></form>
    </div></div>`;
}

function planHtml(m) {
  const p = m.assignment_plan || {};
  return `
    <h3>결정사항(안)</h3><ol>${(p.decisions || []).map((x) => `<li>${esc(x.content)}${x.rationale ? ` <span class="muted">— 근거: ${esc(x.rationale)}</span>` : ''}</li>`).join('')}</ol>
    <h3>업무 배정</h3><table><tr><th>담당</th><th>산출물</th><th>내용</th></tr>${(p.assignments || []).map((a) => `<tr><td>${esc(a.employee)}</td><td>${esc(a.title)}</td><td>${esc(a.description)}</td></tr>`).join('')}</table>
    <h3>검수 기준</h3>${doc(m.review_criteria || '')}`;
}

function hitsHtml(hits) {
  if (!hits || !hits.length) return '';
  return `<p class="muted">금지 수치 검사: ${hits.map((h) => `<span class="${h.level === 'forbidden' ? 'bad' : ''}">${rules.LEVEL_NAMES[h.level] || h.level} "${esc(h.match)}"</span>`).join(', ')}</p>`;
}

function stepsHtml(t) {
  return STEP_NAMES.slice(1, 11).map((n, i) => {
    const step = i + 1;
    const cls = t.step > step || t.status === '완료' ? 'done' : t.step === step ? 'now' : '';
    return `<span class="step ${cls}">${n}</span>`;
  }).join('');
}

router.post('/tasks/:id/approve', async (req, res) => {
  const id = Number(req.params.id);
  try { await engine.approve(id); back(res, `/tasks/${id}`, '승인했습니다. 담당자들이 업무를 시작합니다.'); }
  catch (err) { back(res, `/tasks/${id}`, safeMessage(err)); }
});
router.post('/tasks/:id/reject', async (req, res) => {
  const id = Number(req.params.id);
  try { await engine.reject(id, String(req.body.reason || '')); back(res, `/tasks/${id}`, '반려했습니다. 사유를 반영해 다시 회의합니다.'); }
  catch (err) { back(res, `/tasks/${id}`, safeMessage(err)); }
});
router.post('/tasks/:id/pause', async (req, res) => {
  const id = Number(req.params.id);
  try { await engine.pause(id); back(res, `/tasks/${id}`, '일시정지했습니다.'); }
  catch (err) { back(res, `/tasks/${id}`, safeMessage(err)); }
});
router.post('/tasks/:id/resume', async (req, res) => {
  const id = Number(req.params.id);
  try { await engine.resume(id); back(res, `/tasks/${id}`, '다시 진행합니다.'); }
  catch (err) { back(res, `/tasks/${id}`, safeMessage(err)); }
});

// ───── HTML 보고서 ─────
router.get('/tasks/:id/report', async (req, res) => {
  const id = Number(req.params.id);
  const html = await report.reportHtml(id);
  if (!html) return res.status(404).send(layout('없음', '<h1>최종 보고서가 아직 없습니다.</h1>'));
  if (req.query.download) {
    const name = `세타온_업무${id}_최종보고서.html`;
    res.set('Content-Disposition', `attachment; filename="report-${id}.html"; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  res.type('html').send(html);
});

// ───── 위키 저장 ─────
router.post('/tasks/:id/wiki/draft', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await query('UPDATE tasks SET wiki_draft=NULL WHERE id=$1 AND wiki_path IS NULL', [id]);
    await engine.requestWikiDraft(id);
    back(res, `/tasks/${id}`, '김비서가 위키 저장안을 만들고 있습니다. 1~3분 뒤 이 화면에 나타납니다.');
  } catch (err) { back(res, `/tasks/${id}`, safeMessage(err)); }
});
router.post('/tasks/:id/wiki/save', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await wiki.saveDraft(id);
    back(res, `/tasks/${id}`, `위키에 저장했습니다: ${r.rel}${r.archived ? ` (달이 바뀌어 지난달 로그 ${r.archived}줄을 archive로 옮겼습니다)` : ''}`);
  } catch (err) { back(res, `/tasks/${id}`, safeMessage(err)); }
});
router.post('/tasks/:id/wiki/discard', async (req, res) => {
  const id = Number(req.params.id);
  await query('UPDATE tasks SET wiki_draft=NULL WHERE id=$1 AND wiki_path IS NULL', [id]);
  back(res, `/tasks/${id}`, '위키 저장안을 지웠습니다.');
});

// ───── 메신저 (화면 → 서버) ─────
router.get('/api/messages', async (req, res) => {
  const taskId = req.query.task ? Number(req.query.task) : null;
  const r = await query(
    `SELECT * FROM (SELECT * FROM messages WHERE ${taskId ? 'task_id=$1' : 'task_id IS NULL'} ORDER BY id DESC LIMIT 300) x ORDER BY id`,
    taskId ? [taskId] : []
  );
  res.json(r.rows);
});
router.post('/api/messages', async (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: '내용이 비어 있습니다.' });
  const taskId = req.body.task ? Number(req.body.task) : null;
  try { await engine.ceoSay(taskId, body.slice(0, 4000)); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: safeMessage(err) }); }
});

// ───── 전체 메신저 ─────
router.get('/messenger', async (req, res) => {
  const r = await query(`SELECT m.*, t.title FROM (SELECT * FROM messages ORDER BY id DESC LIMIT 200) m LEFT JOIN tasks t ON t.id=m.task_id ORDER BY m.id`);
  res.send(layout('메신저', `<h1>전체 메신저</h1><p class="muted">모든 업무의 대화가 실시간으로 올라옵니다. 말을 거시려면 해당 업무 화면이나 본부의 일반 대화 창을 쓰세요.</p>
    <div class="card chat all" data-all="1"><div class="chat-head">전체 대화 <span class="live muted">연결 중…</span></div><div class="working" data-all="1" hidden></div><div class="chat-log tall">${r.rows.map((m) => msgHtml(m, true)).join('')}</div></div>`, { active: '/messenger' }));
});

function msgHtml(m, withTask) {
  const cls = m.kind === 'CEO' ? 'ceo' : m.kind === '시스템' ? 'sys' : '';
  return `<div class="msg ${cls}">${withTask && m.task_id ? `<a class="muted" href="/tasks/${m.task_id}">#${m.task_id}</a> ` : ''}<b>${esc(m.kind === 'CEO' ? '대표님' : m.speaker)}</b> <span class="muted">${fmt(m.created_at)}</span><div>${esc(m.body)}</div></div>`;
}

// ───── 과거 업무 검색 ─────
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  let html = '';
  if (q) {
    const rows = await memory.searchRecords(q, { limit: 50 });
    const direct = await query(`SELECT id, title, status, created_at FROM tasks WHERE title ILIKE $1 OR instruction ILIKE $1 OR final_report ILIKE $1 ORDER BY id DESC LIMIT 30`, [`%${q.replace(/[%_\\]/g, '')}%`]);
    const wiki = memory.wikiCandidates(q, 15);
    html = `
      <h2>업무</h2><table>${direct.rows.map((t) => `<tr><td>#${t.id}</td><td><a href="/tasks/${t.id}">${esc(t.title)}</a></td><td>${badge(t.status)}</td><td class="muted">${fmt(t.created_at)}</td></tr>`).join('') || '<tr><td class="muted">없음</td></tr>'}</table>
      <h2>결정·조언·산출물·메모</h2><table>${rows.map((x) => `<tr><td>${esc(x.kind)}</td><td>${x.task_id ? `<a href="/tasks/${x.task_id}">#${x.task_id}</a>` : ''}</td><td>${esc(String(x.text).slice(0, 300))}</td><td class="muted">${esc(x.who || '')} ${fmt(x.created_at)}</td></tr>`).join('') || '<tr><td class="muted">없음</td></tr>'}</table>
      <h2>위키 문서 후보 (C:\\ThetaRO, 읽기 전용)</h2><table>${wiki.map((w) => `<tr><td>${esc(w.name)}</td><td>${esc(w.summary)}</td></tr>`).join('') || '<tr><td class="muted">없음</td></tr>'}</table>`;
  }
  res.send(layout('과거 업무 검색', `<h1>과거 업무 검색</h1>
    <form><div class="row"><input type="text" name="q" value="${esc(q)}" placeholder="예: 비이랩 요금, KT 카탈로그, 한전"><div style="flex:0"><button>검색</button></div></div></form>${html}`, { active: '/search' }));
});

// ───── 직원 ─────
router.get('/staff', async (req, res) => {
  const r = await query(`SELECT e.*, (SELECT count(*)::int FROM ai_usage u WHERE u.employee_id=e.id) AS calls FROM employees e ORDER BY id`);
  const notes = await query(`SELECT n.body, n.created_at, n.task_id, e.name FROM staff_notes n JOIN employees e ON e.id=n.employee_id ORDER BY n.id DESC LIMIT 30`);
  const rows = r.rows.map((e) => {
    const models = e.provider === 'claude' ? CLAUDE_MODELS : GEMINI_MODELS;
    return `<tr><td><b>${esc(e.name)}</b><br><span class="muted">${esc(e.title)}</span></td><td>${esc(e.duty)}</td><td>${esc(e.deliverables)}</td>
      <td>${e.provider === 'claude' ? 'Claude' : 'Gemini(Antigravity)'}<form method="post" action="/staff/${e.id}/model">
      <select name="model" onchange="this.form.submit()">${models.map((m) => `<option ${m === e.model ? 'selected' : ''}>${m}</option>`).join('')}</select></form></td>
      <td>${e.calls}</td></tr>`;
  }).join('');
  res.send(layout('직원', `${notice(req)}<h1>직원</h1>
    <table><tr><th>이름</th><th>담당</th><th>주요 산출물</th><th>모델</th><th>AI 호출</th></tr>${rows}</table>
    <p class="muted">쫑전략은 조언만 합니다. 업무 배정·검수 판정·결정에 관여하지 않고, 조언은 참고 의견으로만 기록됩니다.</p>
    <h2>직원별 작업 메모</h2><table>${notes.rows.map((n) => `<tr><td>${esc(n.name)}</td><td>${esc(n.body)}</td><td><a href="/tasks/${n.task_id}">#${n.task_id}</a></td><td class="muted">${fmt(n.created_at)}</td></tr>`).join('') || '<tr><td class="muted">없음</td></tr>'}</table>
    <h2>금지 수치 점검표</h2>${await rulesHtml()}`, { active: '/staff' }));
});

async function rulesHtml() {
  const r = await rules.loadRules();
  return `<table><tr><th>구분</th><th>항목</th><th>설명</th></tr>${r.map((x) => `<tr><td class="${x.category === 'forbidden' ? 'bad' : ''}">${x.category === 'forbidden' ? '쓰면 안 됨' : '조건부'}</td><td>${esc(x.key)}</td><td>${esc(x.content)}</td></tr>`).join('')}</table>`;
}

router.post('/staff/:id/model', async (req, res) => {
  const e = (await query('SELECT * FROM employees WHERE id=$1', [Number(req.params.id)])).rows[0];
  const model = String(req.body.model || '');
  const allowed = e?.provider === 'claude' ? CLAUDE_MODELS : GEMINI_MODELS;
  if (!e || !allowed.includes(model)) return back(res, '/staff', '바꿀 수 없는 모델입니다.');
  await query('UPDATE employees SET model=$2 WHERE id=$1', [e.id, model]);
  back(res, '/staff', `${e.name}의 모델을 ${model}(으)로 바꿨습니다.`);
});

// ───── 사용량 ─────
router.get('/usage', async (req, res) => {
  const per = await query(`
    SELECT e.name, e.provider,
      count(*) FILTER (WHERE u.created_at > now() - interval '5 hours')::int AS h5,
      count(*) FILTER (WHERE u.created_at > now() - interval '1 day')::int AS d1,
      count(*) FILTER (WHERE u.created_at > now() - interval '7 days')::int AS d7,
      round(avg(u.duration_ms) / 1000.0, 1) AS avg_s,
      sum(u.input_tokens)::bigint AS tin, sum(u.output_tokens)::bigint AS tout
    FROM employees e LEFT JOIN ai_usage u ON u.employee_id=e.id AND u.provider <> 'mock'
    GROUP BY e.id ORDER BY e.id`);
  const errs = await query(`SELECT u.*, e.name FROM ai_usage u LEFT JOIN employees e ON e.id=u.employee_id WHERE NOT ok ORDER BY id DESC LIMIT 20`);
  res.send(layout('사용량', `<h1>AI 사용량</h1>
    <p class="muted">구독 방식이라 요금 대신 호출 횟수를 셉니다. Claude Pro는 5시간 단위 한도와 주간 한도가 있고, 대표님이 Claude 웹이나 Claude Code를 같이 쓰시면 그만큼 줄어듭니다. 정확한 남은 양은 claude.ai 설정의 사용량 화면에서 보실 수 있습니다.</p>
    <table><tr><th>직원</th><th>최근 5시간</th><th>하루</th><th>7일</th><th>평균 응답(초)</th><th>입력/출력 토큰(누적)</th></tr>
    ${per.rows.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.h5}</td><td>${x.d1}</td><td>${x.d7}</td><td>${x.avg_s ?? '-'}</td><td class="muted">${x.tin ?? 0} / ${x.tout ?? 0}</td></tr>`).join('')}</table>
    <h2>최근 실패</h2><table>${errs.rows.map((x) => `<tr><td class="muted">${fmt(x.created_at)}</td><td>${esc(x.name || '')}</td><td>${esc(x.purpose || '')}</td><td>${x.task_id ? `<a href="/tasks/${x.task_id}">#${x.task_id}</a>` : ''}</td><td>${esc(x.error || '')}</td></tr>`).join('') || '<tr><td class="muted">없음</td></tr>'}</table>`, { active: '/usage' }));
});

module.exports = { router, msgHtml };
