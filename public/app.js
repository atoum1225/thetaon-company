// 실시간 화면: 메신저 대화, "지금 누가 무슨 일 하는 중" 표시, 진행 상황 부분 갱신.
(function () {
  if (typeof io === 'undefined') return;
  const socket = io();

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => new Date(d).toLocaleString('ko-KR', { hour12: false });
  const pageTask = (location.pathname.match(/^\/tasks\/(\d+)$/) || [])[1] || null;

  // ───── 진행 상황 부분 갱신 ─────
  // 페이지 전체를 새로 고치지 않고 data-live 표시가 붙은 부분만 바꾼다(메신저 스크롤·입력 중인 글은 그대로).
  let refreshTimer = null;
  function scheduleRefresh() {
    if (!document.querySelector('[data-live]')) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshLive, 700);
  }
  async function refreshLive() {
    let html;
    try { html = await (await fetch(location.href, { headers: { 'X-Live': '1' } })).text(); } catch { return; }
    const fresh = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll('[data-live]').forEach((el) => {
      const next = fresh.querySelector(`[data-live="${el.dataset.live}"]`);
      if (!next) return;
      const a = document.activeElement;
      if (a && el.contains(a) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a.value) return; // 입력 중이면 건드리지 않음
      const open = new Set([...el.querySelectorAll('details[open] > summary')].map((s) => s.textContent));
      const closed = new Set([...el.querySelectorAll('details:not([open]) > summary')].map((s) => s.textContent));
      el.innerHTML = next.innerHTML;
      el.querySelectorAll('details > summary').forEach((s) => {
        if (open.has(s.textContent)) s.parentElement.open = true;
        else if (closed.has(s.textContent)) s.parentElement.open = false;
      });
    });
  }
  socket.on('task', (t) => { if (!pageTask || String(t.id) === pageTask) scheduleRefresh(); });
  socket.on('message', (m) => { if (!pageTask || String(m.task_id ?? '') === pageTask) scheduleRefresh(); });

  // ───── 지금 작업 중 표시 ─────
  let work = null;
  let workTimer = null;
  function paintWork() {
    document.querySelectorAll('.working').forEach((el) => {
      const panelTask = el.dataset.task ?? '';
      const show = work && (el.dataset.all === '1' || String(work.taskId ?? '') === panelTask);
      if (!show) { el.hidden = true; return; }
      const sec = Math.max(0, Math.round((Date.now() - work.startedAt) / 1000));
      el.hidden = false;
      el.innerHTML = `<span class="dots"></span> ${esc(work.label)}${work.taskId && el.dataset.all === '1' ? ` (업무 #${work.taskId})` : ''} · ${sec}초`;
    });
  }
  socket.on('working', (w) => {
    if (w.done) { work = null; clearInterval(workTimer); workTimer = null; }
    else {
      work = w;
      if (!workTimer) workTimer = setInterval(paintWork, 1000);
    }
    paintWork();
    if (w.done) scheduleRefresh();
  });

  // ───── 메신저 ─────
  function render(m, withTask) {
    const cls = m.kind === 'CEO' ? 'ceo' : m.kind === '시스템' ? 'sys' : '';
    const who = m.kind === 'CEO' ? '대표님' : m.speaker;
    const link = withTask && m.task_id ? `<a class="muted" href="/tasks/${m.task_id}">#${m.task_id}</a> ` : '';
    const div = document.createElement('div');
    div.className = `msg ${cls}`;
    div.innerHTML = `${link}<b>${esc(who)}</b> <span class="muted">${fmt(m.created_at)}</span><div>${esc(m.body)}</div>`;
    return div;
  }

  document.querySelectorAll('.chat').forEach((panel) => {
    const all = panel.dataset.all === '1';
    const taskId = panel.dataset.task || '';
    const log = panel.querySelector('.chat-log');
    const live = panel.querySelector('.live');
    const seen = new Set();
    const add = (m) => {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      log.appendChild(render(m, all));
      if (atBottom) log.scrollTop = log.scrollHeight;
    };

    if (!all) {
      fetch(`/api/messages${taskId ? `?task=${taskId}` : ''}`).then((r) => r.json()).then((rows) => {
        rows.forEach(add);
        log.scrollTop = log.scrollHeight;
      });
    } else {
      log.scrollTop = log.scrollHeight;
    }

    socket.on('connect', () => { if (live) live.textContent = '실시간 연결됨'; });
    socket.on('disconnect', () => { if (live) live.textContent = '연결 끊김(서버가 꺼졌는지 확인)'; });
    socket.on('message', (m) => {
      if (all || String(m.task_id ?? '') === taskId) add(m);
    });

    const form = panel.querySelector('.chat-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = form.querySelector('input[name=body]');
        const body = input.value.trim();
        if (!body) return;
        input.value = '';
        const r = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: taskId || null, body }),
        });
        if (!r.ok) alert('보내지 못했습니다: ' + ((await r.json().catch(() => ({}))).error || r.status));
      });
    }
  });
})();
