// 기억 찾기: 새 업무와 관련된 과거 기록(DB)과 위키 문서 후보를 고른다.
const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const { WIKI_DIR } = require('./ai');

const STOP = new Set(['그리고', '관련', '대한', '위한', '해줘', '해주세요', '작성', '정리', '검토', '있는', '하는', '에서', '으로', '이번', '우리', '내용', '부탁', '진행']);

function keywords(text, max = 10) {
  const words = String(text || '')
    .replace(/[%_\\]/g, ' ')
    .split(/[\s,.;:!?()[\]{}"'“”‘’·/<>~=+*#`|-]+/)
    .map((w) => w.replace(/(을|를|이|가|은|는|의|에|와|과|도|로|으로|에서|에게|하고|해줘|해주세요|하기|했다|한다)$/u, ''))
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, max);
}

// 과거 기록 검색. 키워드가 많이 걸릴수록 앞에 온다.
async function searchRecords(text, { excludeTaskId = null, limit = 15 } = {}) {
  const kw = keywords(text);
  if (!kw.length) return [];
  const likes = kw.map((k) => `%${k}%`);
  const r = await query(
    `WITH src AS (
       SELECT '결정' AS kind, d.id, d.task_id, d.content || COALESCE(' / 근거: ' || d.rationale, '') AS text, d.decided_by AS who, d.created_at FROM decisions d
       UNION ALL SELECT '업무', t.id, t.id, t.title || ' — ' || t.instruction, t.status, t.created_at FROM tasks t
       UNION ALL SELECT '전략 조언', a.id, a.task_id, a.content || COALESCE(' / 반영: ' || a.adopted || ' ' || COALESCE(a.reason,''), ''), '쫑전략', a.created_at FROM advice a
       UNION ALL SELECT '산출물', v.id, v.task_id, v.title, e.name, v.created_at FROM deliverables v LEFT JOIN employees e ON e.id = v.employee_id
       UNION ALL SELECT '작업 메모', n.id, n.task_id, n.body, e.name, n.created_at FROM staff_notes n JOIN employees e ON e.id = n.employee_id
       UNION ALL SELECT '최종 보고', t.id, t.id, left(t.final_report, 600), '김비서', t.completed_at FROM tasks t WHERE t.final_report IS NOT NULL
     )
     SELECT kind, id, task_id, text, who, created_at,
            (SELECT count(*) FROM unnest($1::text[]) k WHERE src.text ILIKE k)::int AS score
     FROM src
     WHERE text ILIKE ANY($1::text[]) AND ($2::int IS NULL OR task_id IS DISTINCT FROM $2::int)
     ORDER BY score DESC, created_at DESC NULLS LAST
     LIMIT $3`,
    [likes, excludeTaskId, limit]
  );
  return r.rows;
}

function recordsText(rows) {
  if (!rows.length) return '관련 과거 기록 없음';
  return rows
    .map((x) => `- [${x.kind} #${x.id}${x.task_id ? `, 업무 #${x.task_id}` : ''}, ${x.who || ''}, ${x.created_at ? new Date(x.created_at).toISOString().slice(0, 10) : ''}] ${String(x.text).replace(/\s+/g, ' ').slice(0, 400)}`)
    .join('\n');
}

// 위키 index.md의 한 줄 요약에서 관련 문서 후보를 고른다(읽기만 함).
let wikiCache = { mtime: 0, entries: [], paths: new Map() };
function loadWiki() {
  const indexPath = path.join(WIKI_DIR, 'index.md');
  let stat;
  try { stat = fs.statSync(indexPath); } catch { return wikiCache; }
  if (stat.mtimeMs === wikiCache.mtime) return wikiCache;
  const entries = [];
  for (const line of fs.readFileSync(indexPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^- \[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*[—-]?\s*(.*)$/);
    if (m) entries.push({ name: m[1].trim(), summary: m[2].trim() });
  }
  const paths = new Map();
  const walk = (dir) => {
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.md')) paths.set(d.name.slice(0, -3), p);
    }
  };
  walk(path.join(WIKI_DIR, 'AI-Sessions', 'wiki'));
  walk(path.join(WIKI_DIR, 'AI-Sessions', 'conversations'));
  wikiCache = { mtime: stat.mtimeMs, entries, paths };
  return wikiCache;
}

function wikiCandidates(text, limit = 10) {
  const kw = keywords(text, 12).map((k) => k.toLowerCase());
  if (!kw.length) return [];
  const { entries, paths } = loadWiki();
  return entries
    .map((e) => {
      const hay = `${e.name} ${e.summary}`.toLowerCase();
      return { ...e, path: paths.get(e.name) || null, score: kw.filter((k) => hay.includes(k)).length };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function wikiText(rows) {
  if (!rows.length) return '관련 위키 문서 후보 없음';
  return rows.map((w) => `- ${w.name}${w.path ? ` (${w.path})` : ''}: ${w.summary}`).join('\n');
}

module.exports = { keywords, searchRecords, recordsText, wikiCandidates, wikiText };
