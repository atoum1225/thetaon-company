// 업무 결과를 C:\ThetaRO 위키에 저장한다. 위키의 CLAUDE.md 규칙을 따른다.
// 1) 김비서가 저장안을 만든다(저장 필터 판정, 분류, 파일 이름, 한 줄 요약, 본문)
// 2) 대표님이 화면에서 확인하고 "위키에 저장"을 누르면 그때 파일을 쓴다.
// 새 문서만 만든다. 기존 wiki 문서와 raw는 건드리지 않고, index.md와 log.md는 한 줄씩 추가만 한다.
const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const { WIKI_DIR } = require('./ai');

const CATEGORIES = {
  decision: { dir: 'decisions', dated: true, section: '## Decisions', name: '결정' },
  project: { dir: 'projects', dated: false, section: '## Projects', name: '프로젝트' },
  concept: { dir: 'concepts', dated: false, section: '## Concepts', name: '개념' },
  error: { dir: 'errors', dated: true, section: '## Errors / Lessons', name: '실패·교훈' },
};

const SCHEMA = {
  type: 'object',
  properties: {
    save: { type: 'boolean' },
    filter_reasons: { type: 'array', items: { type: 'string' } },
    not_save_reason: { type: 'string' },
    category: { type: 'string', enum: Object.keys(CATEGORIES) },
    slug: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'active'] },
    body: { type: 'string' },
    links: { type: 'array', items: { type: 'string' } },
  },
  required: ['save', 'filter_reasons', 'not_save_reason', 'category', 'slug', 'title', 'summary', 'status', 'body', 'links'],
};

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function draftPrompt(t, extra) {
  return `본부 업무 #${t.id}의 결과를 C:\\ThetaRO 위키에 저장할 안을 만든다. 파일은 네가 쓰지 않는다(읽기만). 대표님이 확인한 뒤 본부가 저장한다.
먼저 C:\\ThetaRO\\CLAUDE.md를 읽고 Save Filter, Writing Style, Document Format, 파일 이름 규칙을 따른다. 관련 문서가 있는지 index.md에서 찾아본다(log.md 전체는 읽지 않는다).

[업무]
${extra}

[할 일]
- save: 아래 저장 필터 5가지 중 하나라도 통과하면 true. 통과한 항목을 filter_reasons에 적는다. 하나도 없으면 false와 not_save_reason.
  1) 향후 실무에 반복 재사용될 데이터 2) 다른 에이전트·동료가 이어받으려면 읽어야 함 3) 의사결정 근거와 결정권자 추적 필요 4) 다시 하면 안 되는 실패·리스크 5) 팀 공통 규칙·가이드
- category: decision(대표님이 승인·결정한 내용이 중심), project(진행 맥락과 산출물), concept(반복해서 쓸 개념·기준), error(실패와 교훈) 중 하나.
- slug: 영어 소문자 kebab-case, 날짜 없이, 60자 이내(예: kt-catalog-v04-forbidden-number-check). 날짜는 본부가 붙인다.
- title: 한국어 제목. summary: index.md에 올릴 100자 안팎 한 문장("무엇에 관한 문서 + 지금 가장 중요한 상태 하나").
- status: 대표님 결정이 남아 있으면 draft, 아니면 active.
- body: frontmatter와 제목(#) 없이 "## Summary", "## Context", "## Details", "## Links" 순서의 본문. decision이면 결정 내용·근거·결정권자·결정 날짜·재검토 조건을 반드시 넣는다.
  아직 대표님이 정하지 않은 것은 결정으로 쓰지 말고 "확인 필요"로 적는다. 기존 위키 문서와 어긋나는 내용이 있으면 > ⚠️ CONFLICT: 인용 블록으로 표시한다.
  말투는 위키 Writing Style대로(이모지·줄마다 굵은 글씨·화살표·과한 강조 없이, 자연스러운 한국어). 금지 수치는 쓰지 않는다.
- links: 본문 Links 절에 건 기존 위키 문서 이름(확장자 없이, index.md에 실제로 있는 것만).`;
}

async function taskContext(t) {
  const m = (await query('SELECT * FROM meetings WHERE task_id=$1 ORDER BY attempt DESC LIMIT 1', [t.id])).rows[0];
  const dec = (await query('SELECT content, rationale, decided_by, created_at FROM decisions WHERE task_id=$1 ORDER BY id', [t.id])).rows;
  const ceo = (await query(`SELECT body FROM messages WHERE task_id=$1 AND kind='CEO' ORDER BY id`, [t.id])).rows;
  return [
    `제목: ${t.title}`,
    `CEO 지시: ${t.instruction}`,
    `완료: ${t.completed_at ? new Date(t.completed_at).toISOString().slice(0, 10) : '-'}`,
    `확정 결정(대표님 승인):\n${dec.map((d) => `- ${d.content} (근거: ${d.rationale || '-'}, ${d.decided_by})`).join('\n') || '(없음)'}`,
    `회의록:\n${m?.minutes || '(없음)'}`,
    `대표님 말씀:\n${ceo.map((x) => `- ${x.body}`).join('\n') || '(없음)'}`,
    `최종 보고서:\n${t.final_report || '(없음)'}`,
  ].join('\n\n');
}

// 위키에 실제로 있는 문서 이름 목록
function existingDocs() {
  const names = new Set();
  const walk = (dir) => {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.md')) names.add(d.name.slice(0, -3));
    }
  };
  walk(path.join(WIKI_DIR, 'AI-Sessions'));
  return names;
}

// 저장안을 정리한다(파일 이름 확정, 없는 링크 제거).
function normalizeDraft(d) {
  const cat = CATEGORIES[d.category] ? d.category : 'project';
  let slug = String(d.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  slug = slug.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  if (!slug) slug = 'thetaon-task-result';
  const names = existingDocs();
  const base = (CATEGORIES[cat].dated ? `${today()}-` : '') + slug;
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base}-${i}`;
  const links = [...new Set((d.links || []).map((x) => String(x).replace(/^\[\[|\]\]$/g, '').replace(/\.md$/, '').trim()))].filter((x) => names.has(x));
  const summary = String(d.summary || '').replace(/\s+/g, ' ').trim();
  return { ...d, category: cat, slug, name, links, summary };
}

function fileText(d, t) {
  let body = String(d.body || '').replace(/^---[\s\S]*?---\s*/, '').replace(/^#\s+.*\n+/, '').trim();
  const missing = d.links.filter((l) => !body.includes(`[[${l}]]`));
  if (!/^## Links/m.test(body)) body += '\n\n## Links\n';
  if (missing.length) body += `\n${missing.map((l) => `- [[${l}]]`).join('\n')}`;
  return `---
type: ${d.category}
date: ${today()}
status: ${d.status === 'draft' ? 'draft' : 'active'}
source: 세타온 본부(C:\\atoum) 업무 #${t.id} 「${t.title}」 최종 보고서
owner: CEO
---

# ${d.title}

${body.trim()}
`;
}

// log.md 월별 보관: 달이 바뀐 뒤 첫 기록 전에 지난달 줄을 내용·순서 그대로 archive로 옮긴다.
function archiveOldLogLines(logText, nl) {
  const month = today().slice(0, 7);
  const lines = logText.split(/\r?\n/);
  const old = lines.filter((l) => /^\d{4}-\d{2}-\d{2} \|/.test(l) && l.slice(0, 7) < month);
  if (!old.length) return { text: logText, moved: 0 };
  const byMonth = new Map();
  for (const l of old) {
    const m = l.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(l);
  }
  const archiveLinks = [];
  for (const [m, rows] of byMonth) {
    const file = path.join(WIKI_DIR, 'archive', `log-${m}.md`);
    const exists = fs.existsSync(file);
    const before = exists ? fs.readFileSync(file, 'utf8') : `# Agent Work Log ${m}${nl}${nl}${m} 기록 보관본. 더 이상 줄을 추가하지 않는다.${nl}${nl}`;
    const after = before.replace(/\s*$/, nl) + rows.join(nl) + nl;
    fs.writeFileSync(file, after, 'utf8');
    const check = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.startsWith(`${m}-`)).length;
    const had = before.split(/\r?\n/).filter((l) => l.startsWith(`${m}-`)).length;
    if (check !== had + rows.length) throw new Error(`log.md 월별 보관 중 줄 수가 맞지 않습니다(${m}). 저장을 멈췄습니다.`);
    archiveLinks.push(`[[log-${m}]]`);
  }
  const oldSet = new Set(old);
  let rest = lines.filter((l) => !oldSet.has(l));
  rest = rest.map((l) => {
    if (!l.startsWith('- 보관본:')) return l;
    const add = archiveLinks.filter((a) => !l.includes(a));
    return add.length ? `${l} · ${add.join(' · ')}` : l;
  });
  return { text: rest.join(nl), moved: old.length };
}

async function saveDraft(taskId) {
  const t = (await query('SELECT * FROM tasks WHERE id=$1', [taskId])).rows[0];
  if (!t || !t.wiki_draft) throw new Error('저장할 위키 저장안이 없습니다.');
  if (t.wiki_path) throw new Error(`이미 위키에 저장했습니다: ${t.wiki_path}`);
  const d = normalizeDraft(t.wiki_draft); // 저장 직전에 파일 이름 충돌을 다시 확인
  if (!d.save) throw new Error('김비서가 저장 필터를 통과하지 못한다고 판단한 안입니다. 저장하지 않습니다.');
  const cat = CATEGORIES[d.category];

  const docPath = path.join(WIKI_DIR, 'AI-Sessions', 'wiki', cat.dir, `${d.name}.md`);
  const indexPath = path.join(WIKI_DIR, 'index.md');
  const logPath = path.join(WIKI_DIR, 'log.md');
  if (fs.existsSync(docPath)) throw new Error('같은 이름의 문서가 이미 있습니다. 저장안을 다시 만들어 주세요.');

  const indexText = fs.readFileSync(indexPath, 'utf8');
  const nl = indexText.includes('\r\n') ? '\r\n' : '\n';
  const lines = indexText.split(/\r?\n/);
  const h = lines.findIndex((l) => l.trim() === cat.section);
  if (h < 0) throw new Error(`index.md에서 "${cat.section}" 절을 찾지 못했습니다.`);
  let at = h + 1;
  while (at < lines.length && lines[at].trim() === '') at++;
  const entry = `- [[${d.name}]] — ${d.status === 'draft' ? '(draft) ' : ''}${d.summary}`;
  lines.splice(at, 0, entry);

  let logText = fs.readFileSync(logPath, 'utf8');
  const lnl = logText.includes('\r\n') ? '\r\n' : '\n';
  const archived = archiveOldLogLines(logText, lnl);
  logText = archived.text;
  const did = `본부 업무 #${t.id} 결과를 대표님 승인으로 위키에 저장했다(${d.title}) → [[${d.name}]]`.slice(0, 200);
  const logLine = `${today()} | save | ${did} | AI-Sessions/wiki/${cat.dir}`;

  fs.writeFileSync(docPath, fileText(d, t).replace(/\n/g, nl), { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(indexPath, lines.join(nl), 'utf8');
  fs.writeFileSync(logPath, logText.replace(/\s*$/, lnl) + logLine + lnl, 'utf8');

  const rel = path.relative(WIKI_DIR, docPath);
  await query('UPDATE tasks SET wiki_path=$2, wiki_saved_at=now(), wiki_draft=$3 WHERE id=$1', [taskId, rel, d]);
  await query(`INSERT INTO task_events (task_id, kind, actor, detail) VALUES ($1,'위키 저장','CEO',$2)`, [taskId, rel]);
  return { rel, archived: archived.moved };
}

module.exports = { SCHEMA, CATEGORIES, draftPrompt, taskContext, normalizeDraft, fileText, saveDraft };
