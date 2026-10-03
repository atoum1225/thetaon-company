// 업무 사이트 화면들.
const express = require('express');
const { query, safeMessage } = require('./db');
const { layout, esc, badge, icon, avatar } = require('./views');
const engine = require('./engine');
const memory = require('./memory');
const rules = require('./rules');
const wiki = require('./wiki');
const report = require('./report');
const sources = require('./sources');

const router = express.Router();
const STEP_NAMES = ['', '① 접수', '② 과제 정의', '③ 회의 소집', '④ 토론', '⑤ 회의록·배정안', '⑥ CEO 승인 대기', '⑦ 담당자 수행', '⑧ 김비서 검수', '⑨ 전략 조언', '⑩ 최종 보고', '완료'];
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku'];
const GEMINI_MODELS = ['gemini-3.1-pro-high', 'gemini-3.1-pro-low', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium'];

const fmt = (d) => (d ? new Date(d).toLocaleString('ko-KR', { hour12: false }) : '');
const doc = (s) => `<pre class="doc">${esc(s)}</pre>`;
const back = (res, url, msg) => res.redirect(`${url}${url.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}`);
const notice = (req) => (req.query.msg ? `<div class="card notice">${esc(req.query.msg)}</div>` : '');

function chatPanel(taskId, title, trashed = false) {
  return `
  <div class="card chat" data-task="${taskId ?? ''}">
    <div class="chat-head">${icon('chat', 18)}메신저 <span class="muted">${esc(title)}</span> <span class="live muted">연결 중…</span></div>
    <div class="chat-log"></div>
    <div class="working" data-task="${taskId ?? ''}" hidden></div>
    ${trashed ? '<p class="muted">휴지통에 있는 업무라 말을 걸 수 없습니다. 되살리면 다시 대화할 수 있습니다.</p>' : `
    <form class="chat-form">
      <input type="text" name="body" placeholder="대표님 말씀 (멈추려면 '멈춰', 이어서는 '다시 진행')" autocomplete="off">
      <button>${icon('send', 16)}보내기</button>
    </form>`}
  </div>`;
}

const DELETE_CONFIRM = `onsubmit="return confirm('이 업무를 휴지통으로 옮길까요?\\n휴지통에서 언제든 되살릴 수 있습니다.')"`;
const deleteForm = (id, cls = '') => `<form method="post" action="/tasks/${id}/delete" class="inline" ${DELETE_CONFIRM}><button class="red ${cls}">삭제</button></form>`;
const restoreForm = (id, cls = '') => `<form method="post" action="/tasks/${id}/restore" class="inline"><button class="green ${cls}">되살리기</button></form>`;

// 진행 단계를 막대로(⑥ 승인 대기까지가 절반쯤)
function progressBar(t) {
  const pct = t.status === '완료' ? 100 : Math.round(((Math.min(t.step, 10) - 1) / 10) * 100);
  const cls = t.status === '완료' ? 'done' : ['일시정지', '실패', '한도대기', '삭제됨'].includes(t.status) ? 'stop' : '';
  return `<div class="progress ${cls}" title="${esc(STEP_NAMES[t.step] || '')}"><i style="width:${Math.max(pct, 4)}%"></i></div>`;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const EXAMPLES = [
  '비이랩에 보낼 KT 카탈로그 요금 설명 메일 문안을 써 줘. 마감 10/2.',
  'IR 9월판에 남은 금지 수치를 점검하고 고칠 문안을 표로 정리해 줘.',
  '이번 주 파트너 미팅 준비 자료를 한 쪽으로 정리해 줘.',
];

async function statusCounts() {
  const c = await query(`SELECT status, count(*)::int AS n,
    count(*) FILTER (WHERE status='완료' AND completed_at >= date_trunc('day', now()))::int AS today FROM tasks GROUP BY status`);
  const by = Object.fromEntries(c.rows.map((x) => [x.status, x.n]));
  const n = (...s) => s.reduce((a, k) => a + (by[k] || 0), 0);
  return {
    approval: n('승인대기'),
    active: n('접수', '회의중', '수행중', '검수중', '전략조언'),
    today: c.rows.reduce((a, x) => a + x.today, 0),
    trouble: n('일시정지', '한도대기', '실패'),
    trash: n('삭제됨'),
    all: c.rows.reduce((a, x) => a + x.n, 0) - n('삭제됨'),
    done: n('완료'),
    by,
  };
}

// 왼쪽 메뉴 숫자 배지(화면이 실시간으로 불러감)
router.get('/api/counts', async (req, res) => {
  const s = await statusCounts();
  res.json({ approval: s.approval, all: s.active + s.approval });
});

// ───── 대시보드(첫 화면) ─────
router.get('/', async (req, res) => {
  let s;
  let dbErr = null;
  try { s = await statusCounts(); } catch (err) { dbErr = safeMessage(err); }
  if (dbErr) {
    return res.send(layout('대시보드', `<div class="card bad">DB 연결 안 됨: ${esc(dbErr)}</div>`, { active: '/' }));
  }
  const approvals = (await query(`SELECT t.id, t.title, t.updated_at, t.reject_count,
      (SELECT jsonb_array_length(assignment_plan->'assignments') FROM meetings m WHERE m.task_id=t.id ORDER BY attempt DESC LIMIT 1) AS n
    FROM tasks t WHERE status='승인대기' ORDER BY updated_at LIMIT 6`)).rows;
  const active = (await query(`SELECT id, title, status, step, updated_at FROM tasks
    WHERE status NOT IN ('완료','승인대기','삭제됨') ORDER BY updated_at DESC LIMIT 6`)).rows;
  const done = (await query(`SELECT id, title, completed_at, wiki_path FROM tasks WHERE status='완료' ORDER BY completed_at DESC LIMIT 5`)).rows;
  const staff = (await query(`SELECT e.name, e.title, e.provider, e.model,
      (SELECT count(*)::int FROM ai_usage u WHERE u.employee_id=e.id AND u.created_at >= date_trunc('day', now())) AS today
    FROM employees e ORDER BY e.id`)).rows;
  const now = new Date();
  const st = engine.state();

  const stat = (href, ic, color, label, num, hot) =>
    `<a class="stat ${hot ? 'hot' : ''}" href="${href}" style="--c:${color}"><span class="label">${icon(ic, 20)}${label}</span><span class="num">${num}<small>건</small></span></a>`;
  const empty = (ic, text) => `<div class="empty">${icon(ic, 32)}${text}</div>`;

  res.send(layout('대시보드', `
    ${notice(req)}
    ${process.env.AI_MOCK === '1' ? '<div class="card bad">가짜 AI 시험 모드입니다. 실제 AI를 부르지 않습니다.</div>' : ''}
    <div class="dash-top">
      <div class="card profile">
        ${avatar('대표님', 64)}
        <div>
          <div class="who">대표님</div>
          <div class="sub">(주)세타온 · CEO</div>
          <div class="today">${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${WEEKDAY[now.getDay()]}) · 진행기 ${st.busy ? `업무 #${st.current ?? '-'} 처리 중` : '대기 중'}</div>
        </div>
      </div>
      <div class="stats" data-live="stats">
        ${stat('/tasks?status=승인대기', 'approve', '#ea580c', '결재 대기', s.approval, s.approval > 0)}
        ${stat('/tasks?group=active', 'play', '#2563eb', '진행 중', s.active)}
        ${stat('/tasks?status=완료', 'check', '#16a34a', '오늘 완료', s.today)}
        ${stat('/tasks?group=trouble', 'alert', '#dc2626', '확인 필요', s.trouble, s.trouble > 0)}
      </div>
    </div>

    <div class="dash-grid">
      <div>
        <div class="card" id="new">
          <div class="card-head">${icon('send')}김비서에게 업무 지시</div>
          <form method="post" action="/tasks">
            <textarea name="instruction" id="instruction" placeholder="무엇을 할지, 결과물은 무엇인지, 마감은 언제인지 적어 주세요." required></textarea>
            <div class="chips">${EXAMPLES.map((e) => `<span class="chip" data-fill="${esc(e)}">${esc(e.length > 28 ? e.slice(0, 27) + '…' : e)}</span>`).join('')}</div>
            <label class="check"><input type="checkbox" name="research" value="1"> 쫑전략이 신뢰 사이트 원문까지 열어 확인 <span class="muted">(정확하지만 회의가 더 걸립니다. 끄면 검색만 합니다. 김비서가 필요하다고 보면 켤 수도 있습니다)</span></label>
            <div class="form-foot"><span class="muted">김비서가 과제를 정리하고 회의를 연 뒤, 배정안이 나오면 결재를 요청드립니다.</span><button>${icon('send', 16)}지시하기</button></div>
          </form>
        </div>
        <div class="card" data-live="active">
          <div class="card-head">${icon('play')}진행 중인 업무 <a class="more" href="/tasks?group=active">전체 보기</a></div>
          ${active.length ? `<ul class="list">${active.map((t) => `<li><span class="num">#${t.id}</span>
            <span class="grow"><a class="title" href="/tasks/${t.id}">${esc(t.title)}</a><span class="meta">${esc(STEP_NAMES[t.step] || '')} · ${fmt(t.updated_at)}</span></span>
            <span style="width:110px">${progressBar(t)}</span>${badge(t.status)}</li>`).join('')}</ul>` : empty('play', '진행 중인 업무가 없습니다.')}
        </div>
      </div>

      <div>
        <div class="card" data-live="approvals">
          <div class="card-head">${icon('approve')}결재함 <span class="badge" style="--c:#ea580c">${s.approval}건 대기</span><a class="more" href="/tasks?status=승인대기">전체 보기</a></div>
          ${approvals.length ? `<ul class="list">${approvals.map((t) => `<li><span class="num">#${t.id}</span>
            <span class="grow"><a class="title" href="/tasks/${t.id}">${esc(t.title)}</a><span class="meta">업무 배정안 ${t.n || '-'}건${t.reject_count ? ` · 반려 ${t.reject_count}회` : ''} · ${fmt(t.updated_at)}</span></span>
            <a class="btn" href="/tasks/${t.id}">결재하기</a></li>`).join('')}</ul>` : empty('approve', '결재를 기다리는 배정안이 없습니다.')}
        </div>
        <div class="card" data-live="done">
          <div class="card-head">${icon('file')}최근 완료 보고 <a class="more" href="/tasks?status=완료">전체 보기</a></div>
          ${done.length ? `<ul class="list">${done.map((t) => `<li><span class="num">#${t.id}</span>
            <span class="grow"><a class="title" href="/tasks/${t.id}">${esc(t.title)}</a><span class="meta">${fmt(t.completed_at)}${t.wiki_path ? ' · 위키 저장됨' : ''}</span></span>
            <a class="btn gray" href="/tasks/${t.id}/report" target="_blank">보고서</a></li>`).join('')}</ul>` : empty('file', '아직 완료된 보고가 없습니다.')}
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-head">${icon('users')}직원 현황 <a class="more" href="/staff">자세히</a></div>
          <ul class="list staff">${staff.map((e) => `<li data-staff-row="${esc(e.name)}">${avatar(e.name, 38)}
            <span class="grow"><span class="title">${esc(e.name)} <span class="muted">${esc(e.title)}</span></span>
            <span class="state">대기 중</span> <span class="meta">· 오늘 ${e.today}회 · ${e.provider === 'claude' ? 'Claude' : 'Gemini'}</span></span></li>`).join('')}</ul>
        </div>
        ${chatPanel(null, '업무와 무관한 대화')}
      </div>
    </div>
  `, { active: '/' }));
});

// ───── 업무함 ─────
router.get('/tasks', async (req, res) => {
  const status = String(req.query.status || '');
  const group = String(req.query.group || '');
  const GROUPS = { active: ['접수', '회의중', '수행중', '검수중', '전략조언'], trouble: ['일시정지', '한도대기', '실패'], trash: ['삭제됨'] };
  const list = GROUPS[group] || (status ? [status] : null);
  const r = await query(
    `SELECT id, title, status, step, deadline, reject_count, rework_count, created_at, updated_at, deleted_at FROM tasks
     WHERE ($1::text[] IS NULL AND status <> '삭제됨' OR status = ANY($1)) ORDER BY id DESC LIMIT 200`, [list]);
  const s = await statusCounts();
  const tab = (href, label, n, on) => `<a class="tab ${on ? 'on' : ''}" href="${href}">${label}<em>${n}</em></a>`;
  const tabs = [
    tab('/tasks', '전체', s.all, !status && !group),
    tab('/tasks?status=승인대기', '결재 대기', s.approval, status === '승인대기'),
    tab('/tasks?group=active', '진행 중', s.active, group === 'active'),
    tab('/tasks?status=완료', '완료', s.done, status === '완료'),
    tab('/tasks?group=trouble', '확인 필요', s.trouble, group === 'trouble'),
    tab('/tasks?group=trash', '휴지통', s.trash, group === 'trash'),
  ].join('');
  // 확인 필요 탭에서는 바로 지우고, 휴지통 탭에서는 바로 되살릴 수 있게 한다.
  const action = group === 'trouble' ? (t) => deleteForm(t.id, 'sm') : group === 'trash' ? (t) => restoreForm(t.id, 'sm') : null;
  const rows = r.rows.map((t) => `<tr><td class="muted">#${t.id}</td><td><a href="/tasks/${t.id}"><b>${esc(t.title)}</b></a></td><td>${badge(t.status)}</td>
    <td><div class="muted" style="margin-bottom:4px">${esc(STEP_NAMES[t.step] || '')}</div>${progressBar(t)}</td><td>${esc(t.deadline || '-')}</td>
    <td class="muted">${t.reject_count} / ${t.rework_count}</td><td class="muted">${fmt(group === 'trash' ? t.deleted_at : t.created_at)}</td>
    ${action ? `<td>${action(t)}</td>` : ''}</tr>`).join('');
  const title = status === '승인대기' ? '결재 대기' : group === 'active' ? '진행 중인 업무' : group === 'trouble' ? '확인이 필요한 업무' : group === 'trash' ? '휴지통' : status || '업무함';
  const cols = action ? 8 : 7;
  res.send(layout('업무함', `${notice(req)}<h1>${icon('inbox', 24)}${esc(title)}</h1><div class="tabs">${tabs}</div>
    ${group === 'trash' ? '<p class="muted">지운 업무는 목록·검색과 직원들이 참고하는 과거 기록에서 빠져 있습니다. 되살리면 일시정지 상태로 돌아오고, "다시 진행"을 누르면 멈춘 곳부터 이어서 합니다.</p>' : ''}
    <div class="card table-card" data-live="list"><table><tr><th>번호</th><th>업무</th><th>상태</th><th style="width:220px">진행</th><th>마감</th><th>반려/재작업</th><th>${group === 'trash' ? '지운 시각' : '지시 시각'}</th>${action ? '<th></th>' : ''}</tr>
    ${rows || `<tr><td colspan="${cols}"><div class="empty">${icon('inbox', 32)}해당하는 업무가 없습니다.</div></td></tr>`}</table></div>`,
  { active: status === '승인대기' ? '/tasks?status=승인대기' : '/tasks' }));
});

router.post('/tasks', async (req, res) => {
  const instruction = String(req.body.instruction || '').trim();
  if (!instruction) return back(res, '/', '지시 내용을 입력해 주세요.');
  const id = await engine.createTask(instruction, { research: req.body.research === '1' });
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
  const sources = (await query('SELECT * FROM external_sources WHERE task_id=$1 ORDER BY id', [id])).rows;
  const d = t.definition || {};
  const last = meetings[meetings.length - 1];

  const controls = [];
  if (engine.PAUSABLE.includes(t.status)) controls.push(`<form method="post" action="/tasks/${id}/pause" class="inline"><button class="gray">일시정지</button></form>`);
  if (['일시정지', '한도대기', '실패'].includes(t.status)) controls.push(`<form method="post" action="/tasks/${id}/resume" class="inline"><button class="green">다시 진행</button></form>`);
  if (engine.DELETABLE.includes(t.status)) controls.push(deleteForm(id));
  const trashed = t.status === '삭제됨';
  if (trashed) controls.push(`<p class="muted">휴지통에 있는 업무입니다(${fmt(t.deleted_at)}에 지움). 되살리면 일시정지 상태로 돌아옵니다.</p>${restoreForm(id)}`);

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
      ${researchHtml(t)}
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
        <div class="card"><h2 style="margin-top:0">외부 자료 <span class="muted" style="font-size:14px;font-weight:400">쫑전략 조사 · 신뢰 사이트</span></h2>${sourcesHtml(sources)}</div>
        <div class="card"><h2 style="margin-top:0">진행 기록</h2><table>${events.map((e) => `<tr><td class="muted">${fmt(e.created_at)}</td><td>${esc(e.kind)}</td><td>${esc(e.actor)}</td><td>${esc(e.detail || '')}</td></tr>`).join('')}</table></div>
      </div>
      <div>${chatPanel(id, `업무 #${id}`, trashed)}</div>
    </div>
  `, { active: '/tasks' }));
});

// 쫑전략이 원문까지 여는지(대표님 지시·김비서 요청) 표시와 켜기/끄기 버튼
function researchHtml(t) {
  const who = t.research_by === 'CEO' ? '대표님 지시' : t.research_by === '김비서' ? `김비서 요청${t.research_reason ? `: ${t.research_reason}` : ''}` : '';
  const state = t.research ? `<b>원문까지 확인</b>${who ? ` (${esc(who)})` : ''}` : `검색만${t.research_by === 'CEO' ? ' (대표님 지시)' : ''}`;
  const btn = ['완료', '삭제됨'].includes(t.status) ? ''
    : `<form method="post" action="/tasks/${t.id}/research" class="inline"><input type="hidden" name="on" value="${t.research ? '0' : '1'}">
       <button class="gray sm">${t.research ? '원문 확인 끄기' : '원문 확인 켜기'}</button></form>`;
  return `<p class="muted">쫑전략 외부 자료 조사: ${state} ${btn}</p>`;
}

function sourcesHtml(rows) {
  if (!rows.length) return '<p class="muted">아직 찾은 외부 자료가 없습니다. 쫑전략이 회의 첫 발언과 산출물 조언 때 찾습니다.</p>';
  const link = (u) => (/^https?:\/\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u || '-'));
  const when = (p) => (p === 'advise' ? '산출물 조언' : '회의');
  return `<p class="muted">검색 요약을 옮긴 자료는 틀릴 수 있습니다. 대외 문서에 쓰기 전에 원문을 확인해 주세요.</p>
    <table><tr><th>기관·자료</th><th>내용</th><th>확인</th></tr>${rows.map((s) => `<tr${s.trusted ? '' : ' class="muted"'}>
      <td><b>${esc(s.org || '')}</b><br>${esc(s.title || '')} <span class="muted">${esc(s.pub_date || '')}</span><br><small>${link(s.url)}</small></td>
      <td>${esc(s.point || '')}</td>
      <td><small>${s.opened ? '<span class="ok">원문 확인함</span>' : '원문 확인 전'}<br>${s.trusted ? '' : '<span class="bad">신뢰 목록 밖</span><br>'}${when(s.purpose)} · ${fmt(s.created_at)}</small></td></tr>`).join('')}</table>`;
}

function wikiHtml(t) {
  const id = t.id;
  if (t.wiki_path) {
    return `<div class="card"><h2 style="margin-top:0">위키 저장</h2><p class="ok">저장했습니다: C:\\ThetaRO\\${esc(t.wiki_path)}</p>
      <p class="muted">${fmt(t.wiki_saved_at)} · index.md와 log.md에도 한 줄씩 추가했습니다. 옵시디언에서 바로 보입니다.</p></div>`;
  }
  if (!t.final_report) return '';
  const p = wiki.plan(t);
  const where = `C:\\ThetaRO\\${p.rel}`;
  return `<div class="card"><h2 style="margin-top:0">위키 저장</h2>
    <p class="muted">최종 보고서를 그대로 위키에 저장합니다. AI를 다시 부르지 않고 바로 저장됩니다.</p>
    <table>
      <tr><th>저장 위치</th><td>${esc(where)}</td></tr>
      <tr><th>index.md 한 줄 요약</th><td>${p.status === 'draft' ? '(draft) ' : ''}${esc(p.summary)}</td></tr>
    </table>
    <form method="post" action="/tasks/${id}/wiki/save" style="margin-top:10px"
      onsubmit="return confirm('최종 보고서를 위키에 저장할까요?\\n\\n' + ${JSON.stringify(where).replace(/"/g, '&quot;')})">
      <button class="green">최종 보고서를 위키에 저장</button></form></div>`;
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
router.post('/tasks/:id/research', async (req, res) => {
  const id = Number(req.params.id);
  const on = req.body.on === '1';
  try { await engine.setResearch(id, on); back(res, `/tasks/${id}`, on ? '쫑전략 원문 확인을 켰습니다.' : '쫑전략 원문 확인을 껐습니다. 검색만 합니다.'); }
  catch (err) { back(res, `/tasks/${id}`, safeMessage(err)); }
});
router.post('/tasks/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  try { await engine.trash(id); back(res, '/tasks?group=trouble', `업무 #${id}을 휴지통으로 옮겼습니다. 휴지통 탭에서 되살릴 수 있습니다.`); }
  catch (err) { back(res, `/tasks/${id}`, safeMessage(err)); }
});
router.post('/tasks/:id/restore', async (req, res) => {
  const id = Number(req.params.id);
  try { await engine.restore(id); back(res, `/tasks/${id}`, '되살렸습니다. 일시정지 상태입니다. "다시 진행"을 누르면 멈춘 곳부터 이어서 합니다.'); }
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
router.post('/tasks/:id/wiki/save', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const r = await wiki.saveReport(id);
    back(res, `/tasks/${id}`, `위키에 저장했습니다: C:\\ThetaRO\\${r.rel}${r.archived ? ` (달이 바뀌어 지난달 로그 ${r.archived}줄을 archive로 옮겼습니다)` : ''}`);
  } catch (err) { back(res, `/tasks/${id}`, safeMessage(err)); }
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
  const r = await query(`SELECT m.*, t.title FROM (SELECT * FROM messages WHERE task_id IS NULL OR task_id NOT IN (SELECT id FROM tasks WHERE status='삭제됨')
    ORDER BY id DESC LIMIT 200) m LEFT JOIN tasks t ON t.id=m.task_id ORDER BY m.id`);
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
    const direct = await query(`SELECT id, title, status, created_at FROM tasks WHERE status <> '삭제됨' AND (title ILIKE $1 OR instruction ILIKE $1 OR final_report ILIKE $1) ORDER BY id DESC LIMIT 30`, [`%${q.replace(/[%_\\]/g, '')}%`]);
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
  const notes = await query(`SELECT n.body, n.created_at, n.task_id, e.name FROM staff_notes n JOIN employees e ON e.id=n.employee_id
    WHERE n.task_id IS NULL OR n.task_id NOT IN (SELECT id FROM tasks WHERE status='삭제됨') ORDER BY n.id DESC LIMIT 30`);
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
    <h2>금지 수치 점검표</h2>${await rulesHtml()}
    <h2>쫑전략 신뢰 사이트 목록</h2>
    <p class="muted">쫑전략은 이 사이트들에서만 외부 자료를 찾습니다. 도메인 아래 주소도 포함됩니다(go.kr이면 모든 정부 부처). 원문 열기는 대표님이 지시하시거나 김비서가 요청한 업무에서만 하고, 목록 밖 사이트는 agy가 막습니다. 목록은 src/sources.js에 있습니다.</p>
    <table><tr><th>구분</th><th>사이트</th></tr>${sources.TRUSTED.map((g) => `<tr><td>${esc(g.group)}</td><td>${esc(g.domains.join(', '))}</td></tr>`).join('')}</table>`, { active: '/staff' }));
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
