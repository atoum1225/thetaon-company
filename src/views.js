// 모든 화면이 함께 쓰는 틀(그룹웨어형: 위쪽 바 + 왼쪽 메뉴 + 카드). 화면 글자는 모두 escape를 거쳐 넣는다.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_COLORS = {
  접수: '#64748b', 회의중: '#7c3aed', 승인대기: '#ea580c', 수행중: '#2563eb',
  검수중: '#0891b2', 전략조언: '#059669', 완료: '#16a34a', 일시정지: '#6b7280',
  한도대기: '#b45309', 실패: '#dc2626', 삭제됨: '#9ca3af',
};

function badge(status) {
  const c = STATUS_COLORS[status] || '#64748b';
  return `<span class="badge" style="--c:${c}">${esc(status)}</span>`;
}

// 선 아이콘(외부 파일 없이 SVG로)
const P = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  inbox: '<path d="M3 13l3-8h12l3 8"/><path d="M3 13v6h18v-6h-5l-2 3h-4l-2-3z"/>',
  approve: '<path d="M9 11l2 2 4-4"/><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 17h8"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.5c2.6.2 4.4 2 5 5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  send: '<path d="M4 12l16-8-6 16-2-6z"/><path d="M12 14l8-10"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  book: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v13"/>',
};
function icon(name, size = 20) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// 직원 얼굴 대신 쓰는 동그란 이름 표시
const AVATAR_COLORS = { 김비서: '#1e40af', 황기획: '#7c3aed', 송개발: '#0f766e', 서영업: '#c2410c', 쫑전략: '#047857', 대표님: '#334155' };
function avatar(name, size = 36) {
  const c = AVATAR_COLORS[name] || '#475569';
  const ch = String(name || '?').slice(0, 1);
  return `<span class="avatar" style="--c:${c};--s:${size}px" data-staff="${esc(name)}">${esc(ch)}</span>`;
}

function layout(title, body, { active = '' } = {}) {
  const nav = [
    ['/', '대시보드', 'home'],
    ['/tasks', '업무함', 'inbox', 'all'],
    ['/tasks?status=승인대기', '결재 대기', 'approve', 'approval'],
    ['/messenger', '메신저', 'chat'],
    ['/search', '과거 업무 검색', 'search'],
    ['/staff', '직원·규칙', 'users'],
    ['/usage', 'AI 사용량', 'chart'],
  ].map(([href, label, ic, count]) => `<a href="${href}" class="nav-item ${active === href ? 'on' : ''}">${icon(ic)}<span>${label}</span>${count ? `<em class="nav-count" data-count="${count}" hidden></em>` : ''}</a>`).join('');

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 세타온 본부</title>
<link rel="stylesheet" href="/static/style.css">
</head><body>
<header class="topbar">
  <a class="logo" href="/"><span class="logo-mark">θ</span><span class="logo-text">Theta<b>ON</b></span><span class="logo-sub">본부</span></a>
  <form class="top-search" action="/search">${icon('search', 18)}<input type="text" name="q" placeholder="과거 업무·결정·산출물 검색" autocomplete="off"></form>
  <div class="top-right">
    <div class="working top" data-all="1" hidden></div>
    <span class="top-user">${avatar('대표님', 32)}<span>대표님</span></span>
  </div>
</header>
<div class="shell">
  <aside class="sidebar">
    <a class="new-task" href="/#new">${icon('plus', 18)}<span>새 업무 지시</span></a>
    <nav>${nav}</nav>
    <div class="side-foot">이 PC 안에서만 열리는 화면입니다<br>127.0.0.1:4100</div>
  </aside>
  <main>${body}</main>
</div>
<script src="/socket.io/socket.io.js"></script>
<script src="/static/app.js"></script>
</body></html>`;
}

module.exports = { esc, badge, layout, icon, avatar, STATUS_COLORS };
