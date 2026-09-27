// 메신저 화면: 대화를 실시간으로 보여 주고 대표님 말씀을 보낸다.
(function () {
  const panels = document.querySelectorAll('.chat');
  if (!panels.length || typeof io === 'undefined') return;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => new Date(d).toLocaleString('ko-KR', { hour12: false });

  function render(m, withTask) {
    const cls = m.kind === 'CEO' ? 'ceo' : m.kind === '시스템' ? 'sys' : '';
    const who = m.kind === 'CEO' ? '대표님' : m.speaker;
    const link = withTask && m.task_id ? `<a class="muted" href="/tasks/${m.task_id}">#${m.task_id}</a> ` : '';
    const div = document.createElement('div');
    div.className = `msg ${cls}`;
    div.innerHTML = `${link}<b>${esc(who)}</b> <span class="muted">${fmt(m.created_at)}</span><div>${esc(m.body)}</div>`;
    return div;
  }

  const socket = io();
  panels.forEach((panel) => {
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

  // 업무 상태가 바뀌면 업무 화면을 새로 고친다(입력 중이 아닐 때만).
  const m = location.pathname.match(/^\/tasks\/(\d+)$/);
  if (m) {
    socket.on('task', (t) => {
      if (String(t.id) !== m[1]) return;
      const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.value;
      if (!typing) location.reload();
    });
  }
})();
