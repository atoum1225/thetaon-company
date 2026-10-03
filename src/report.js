// 최종 보고서를 한 장짜리 HTML로 만든다. 브라우저에서 보거나 파일로 내려받아 보관·전달할 수 있다.
// 외부 글꼴·스크립트 없이 파일 하나로 완결된다(PC 밖으로 나가는 연결 없음).
const { Marked } = require('marked');
const { query } = require('./db');
const { esc } = require('./views');

// AI가 쓴 글이라 HTML 태그는 그대로 두지 않고 글자로 보여 준다. 링크는 http(s)만 살린다.
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) { return esc(text); },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      return /^https?:\/\//i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    },
    image({ text }) { return esc(text || ''); },
  },
});
const render = (s) => md.parse(String(s || '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => `〔${b || a}〕`));

const fmt = (d) => (d ? new Date(d).toLocaleString('ko-KR', { hour12: false }) : '-');

async function reportHtml(id) {
  const t = (await query('SELECT * FROM tasks WHERE id=$1', [id])).rows[0];
  if (!t || !t.final_report) return null;
  const decisions = (await query('SELECT content, rationale, decided_by FROM decisions WHERE task_id=$1 ORDER BY id', [id])).rows;
  const deliv = (await query(
    `SELECT DISTINCT ON (assignment_idx) v.*, e.name FROM deliverables v LEFT JOIN employees e ON e.id=v.employee_id
     WHERE task_id=$1 ORDER BY assignment_idx, version DESC`, [id])).rows;
  const advice = (await query('SELECT content, adopted, reason FROM advice WHERE task_id=$1 ORDER BY id DESC LIMIT 1', [id])).rows[0];
  const title = `업무 #${t.id} ${t.title} — 최종 보고서`;

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { --ink:#1f2937; --muted:#6b7280; --line:#e5e7eb; --accent:#1e3a8a; --bg:#f6f7f9; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font-family:"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif; line-height:1.7; font-size:15px; }
  .page { max-width: 860px; margin: 32px auto; background:#fff; border:1px solid var(--line); border-radius:10px; padding: 40px 48px; }
  header { border-bottom: 3px solid var(--accent); padding-bottom: 14px; margin-bottom: 24px; }
  .org { color: var(--accent); font-weight: 700; letter-spacing: .02em; }
  h1.title { font-size: 24px; margin: 6px 0 10px; }
  .meta { color: var(--muted); font-size: 13px; display:flex; flex-wrap:wrap; gap: 4px 18px; }
  .report h1 { font-size: 20px; } .report h2 { font-size: 18px; border-left: 4px solid var(--accent); padding-left: 10px; margin-top: 28px; }
  .report h3 { font-size: 16px; }
  .report ul, .report ol { margin: 6px 0 10px; padding-left: 22px; } .report li { margin: 3px 0; }
  .report p { margin: 6px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 14px; }
  th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  blockquote { margin: 12px 0; padding: 8px 14px; border-left: 4px solid #f59e0b; background: #fffbeb; }
  code { background:#f3f4f6; padding: 1px 4px; border-radius: 4px; }
  del { color: #9ca3af; }
  section.appendix { margin-top: 36px; border-top: 1px dashed var(--line); padding-top: 16px; }
  section.appendix h2 { font-size: 17px; }
  details { border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; margin: 8px 0; }
  summary { cursor: pointer; font-weight: 600; }
  .note { color: var(--muted); font-size: 13px; }
  .toolbar { max-width: 860px; margin: 16px auto 0; display:flex; gap:8px; justify-content:flex-end; }
  .toolbar button { padding: 6px 14px; border:1px solid var(--line); background:#fff; border-radius:6px; cursor:pointer; font: inherit; }
  @media print { body { background:#fff; } .toolbar { display:none; } .page { border:0; margin:0; padding:0; } details { break-inside: avoid; } details > * { display:block; } }
  @media (max-width: 700px) { .page { padding: 20px; margin: 0; border-radius:0; } }
</style>
</head><body>
<div class="toolbar"><button onclick="document.querySelectorAll('details').forEach(d=>d.open=true);window.print()">인쇄 / PDF로 저장</button></div>
<div class="page">
  <header>
    <div class="org">(주)세타온 · 비서실</div>
    <h1 class="title">${esc(t.title)}</h1>
    <div class="meta">
      <span>업무 #${t.id}</span><span>지시 ${fmt(t.created_at)}</span><span>완료 ${fmt(t.completed_at)}</span>
      <span>마감 ${esc(t.deadline || '-')}</span><span>반려 ${t.reject_count}회 · 재작업 ${t.rework_count}회</span><span>작성 김비서</span>
    </div>
  </header>
  <p class="note"><b>CEO 지시:</b> ${esc(t.instruction)}</p>
  <div class="report">${render(t.final_report)}</div>

  <section class="appendix">
    <h2>부록</h2>
    ${decisions.length ? `<details open><summary>확정된 결정사항 (${decisions.length}건)</summary><ol>${decisions.map((d) => `<li>${esc(d.content)}${d.rationale ? ` <span class="note">— ${esc(d.rationale)}</span>` : ''}</li>`).join('')}</ol></details>` : ''}
    ${deliv.map((v) => `<details><summary>산출물: ${esc(v.title)} v${v.version} (${esc(v.name || '')}) — 검수 ${esc(v.review_result || '전')}</summary>
      ${v.review_note ? `<p class="note">검수 의견: ${esc(v.review_note)}</p>` : ''}<div>${render(v.body)}</div></details>`).join('')}
    ${advice ? `<details><summary>쫑전략 조언 (AI 조언, 참고 의견) — 김비서 판단: ${esc(advice.adopted || '-')}</summary>
      <div>${render(advice.content)}</div><p class="note">반영 이유: ${esc(advice.reason || '-')}</p></details>` : ''}
    <p class="note">이 문서는 세타온 본부(AI 가상 회사)가 만든 내부 보고서입니다. 대외로 쓰기 전에 수치와 근거를 확인해 주세요. 만든 시각 ${fmt(new Date())}</p>
  </section>
</div>
</body></html>`;
}

module.exports = { reportHtml, render };
