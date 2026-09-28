// 최종 보고서를 C:\ThetaRO 위키에 그대로 저장한다(AI를 다시 부르지 않음).
// 위키 CLAUDE.md 규칙에 맞게 본부가 틀만 씌운다: frontmatter, Summary·Context·Details·Links,
// 영어 kebab-case 파일 이름, index.md 한 줄 요약, log.md 한 줄(월별 보관 포함).
// 새 문서만 만든다. 기존 wiki 문서와 raw는 건드리지 않고, index.md와 log.md는 한 줄씩 추가만 한다.
const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const { WIKI_DIR } = require('./ai');

// 업무 결과 보고서는 위키 분류 중 "프로젝트별 진행 맥락과 산출물"에 둔다.
const TARGET = { type: 'project', dir: 'projects', section: '## Projects' };

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

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

// 보고서의 "요약" 절에서 첫 문장을 뽑아 index.md 한 줄 요약(100자 안팎)으로 쓴다.
function summaryOf(report, title) {
  const text = String(report || '');
  const sec = text.match(/^#{1,3}\s*요약[^\n]*\n+([\s\S]*?)(?=\n#{1,3}\s|$)/m);
  const src = (sec ? sec[1] : text.replace(/^#.*$/gm, ''))
    .replace(/\*\*|__|[*`>]/g, '').replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').replace(/\s+/g, ' ').trim();
  let s = (src.match(/^.*?(?:다|요|음)\.(?=\s|$)/) || [src])[0];
  if (s.length > 110) s = s.slice(0, 105).replace(/\s\S*$/, '') + '…';
  return s || title;
}

function plan(t) {
  const names = existingDocs();
  const base = `thetaon-hq-task-${t.id}-report`;
  let name = base;
  for (let i = 2; names.has(name); i++) name = `${base}-${i}`;
  // 보고서에 대표님 확인이 남아 있으면 위키 규칙대로 draft로 둔다.
  const pending = /대표님이?\s*확인하실|확인\s*필요|CEO\s*확인|승인\s*(?:요청|대기)|판단\s*요청/.test(t.final_report || '');
  const links = [...new Set([...(t.final_report || '').matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((m) => m[1].trim()))].filter((x) => names.has(x));
  return {
    name,
    rel: path.join('AI-Sessions', 'wiki', TARGET.dir, `${name}.md`),
    status: pending ? 'draft' : 'active',
    summary: `(본부 #${t.id}) ${summaryOf(t.final_report, t.title)}`,
    links,
  };
}

function fileText(t, p) {
  const date = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
  // 보고서 안의 제목 단계를 한 단계씩 내려서 Details 아래에 넣는다(# → ###, ## → ###).
  const body = String(t.final_report || '').trim()
    .replace(/^#\s+.*\n+/, '')
    .replace(/^#{1,3}\s*요약[^\n]*\n+[\s\S]*?(?=\n#{1,3}\s|$)/m, '') // 요약은 Summary 절에 이미 있으므로 뺀다
    .trim()
    .replace(/^(#{1,4})\s/gm, (m, h) => `${'#'.repeat(Math.min(6, h.length + 2 - (h.length > 1 ? 1 : 0)))} `);
  const sec = String(t.final_report || '').match(/^#{1,3}\s*요약[^\n]*\n+([\s\S]*?)(?=\n#{1,3}\s|$)/m);
  const summary = (sec ? sec[1] : p.summary).trim();
  return `---
type: ${TARGET.type}
date: ${today()}
status: ${p.status}
source: 세타온 본부(C:\\atoum) 업무 #${t.id} 최종 보고서
owner: CEO
---

# ${t.title} (본부 업무 #${t.id} 결과 보고)

## Summary

${summary}

## Context

대표님 지시: ${t.instruction}

세타온 본부(AI 가상 회사)의 김비서가 회의·분업·검수를 거쳐 작성한 최종 보고서를 대표님 확인 후 그대로 옮겼다. 지시 ${date(t.created_at)}, 완료 ${date(t.completed_at)}, 반려 ${t.reject_count}회, 재작업 ${t.rework_count}회. 회의록·산출물 원문은 본부 업무 #${t.id} 화면에 있다.

## Details

${body}

## Links

${p.links.length ? p.links.map((l) => `- [[${l}]]`).join('\n') : '- (보고서에 연결된 위키 문서 없음)'}
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

async function saveReport(taskId) {
  const t = (await query('SELECT * FROM tasks WHERE id=$1', [taskId])).rows[0];
  if (!t || t.status !== '완료' || !t.final_report) throw new Error('최종 보고서가 있는 완료된 업무만 저장할 수 있습니다.');
  if (t.wiki_path) throw new Error(`이미 위키에 저장했습니다: ${t.wiki_path}`);
  const p = plan(t);

  const docPath = path.join(WIKI_DIR, p.rel);
  const indexPath = path.join(WIKI_DIR, 'index.md');
  const logPath = path.join(WIKI_DIR, 'log.md');

  const indexText = fs.readFileSync(indexPath, 'utf8');
  const nl = indexText.includes('\r\n') ? '\r\n' : '\n';
  const lines = indexText.split(/\r?\n/);
  const h = lines.findIndex((l) => l.trim() === TARGET.section);
  if (h < 0) throw new Error(`index.md에서 "${TARGET.section}" 절을 찾지 못했습니다.`);
  let at = h + 1;
  while (at < lines.length && lines[at].trim() === '') at++;
  lines.splice(at, 0, `- [[${p.name}]] — ${p.status === 'draft' ? '(draft) ' : ''}${p.summary}`);

  let logText = fs.readFileSync(logPath, 'utf8');
  const lnl = logText.includes('\r\n') ? '\r\n' : '\n';
  const archived = archiveOldLogLines(logText, lnl);
  logText = archived.text;
  const did = `본부 업무 #${t.id}(${t.title}) 최종 보고서를 대표님 확인 후 위키에 옮겼다 → [[${p.name}]]`.slice(0, 200);
  const logLine = `${today()} | save | ${did} | AI-Sessions/wiki/${TARGET.dir}`;

  fs.writeFileSync(docPath, fileText(t, p).replace(/\n/g, nl), { encoding: 'utf8', flag: 'wx' }); // 같은 이름이 있으면 실패(덮어쓰지 않음)
  fs.writeFileSync(indexPath, lines.join(nl), 'utf8');
  fs.writeFileSync(logPath, logText.replace(/\s*$/, lnl) + logLine + lnl, 'utf8');

  await query('UPDATE tasks SET wiki_path=$2, wiki_saved_at=now() WHERE id=$1', [taskId, p.rel]);
  await query(`INSERT INTO task_events (task_id, kind, actor, detail) VALUES ($1,'위키 저장','CEO',$2)`, [taskId, p.rel]);
  return { rel: p.rel, archived: archived.moved };
}

module.exports = { saveReport, plan, fileText, TARGET };
