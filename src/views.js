// 모든 화면이 함께 쓰는 틀. 화면 글자는 모두 escape를 거쳐 넣는다.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_COLORS = {
  접수: '#64748b', 회의중: '#7c3aed', 승인대기: '#d97706', 수행중: '#2563eb',
  검수중: '#0891b2', 전략조언: '#059669', 완료: '#16a34a', 일시정지: '#9ca3af',
  한도대기: '#b45309', 실패: '#dc2626',
};

function badge(status) {
  const c = STATUS_COLORS[status] || '#64748b';
  return `<span class="badge" style="background:${c}">${esc(status)}</span>`;
}

function layout(title, body, { active = '' } = {}) {
  const menu = [
    ['/', '본부'],
    ['/tasks', '업무'],
    ['/search', '과거 업무 검색'],
    ['/staff', '직원'],
    ['/usage', '사용량'],
  ]
    .map(([href, label]) => `<a href="${href}" class="${active === href ? 'on' : ''}">${label}</a>`)
    .join('');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · 세타온 본부</title>
<link rel="stylesheet" href="/static/style.css">
</head><body>
<header><div class="brand">세타온 본부</div><nav>${menu}</nav></header>
<main>${body}</main>
</body></html>`;
}

module.exports = { esc, badge, layout };
