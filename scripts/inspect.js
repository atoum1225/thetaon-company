// 업무 상태와 대화를 터미널에서 훑어보기: node scripts/inspect.js [업무번호]
const { query, pool } = require('../src/db');

(async () => {
  const id = process.argv[2] ? Number(process.argv[2]) : null;
  const t = await query(`SELECT id, title, status, step, reject_count, rework_count, error FROM tasks ${id ? 'WHERE id=$1' : ''} ORDER BY id`, id ? [id] : []);
  console.table(t.rows);
  const m = await query(`SELECT task_id, kind, speaker, left(replace(body, E'\\n', ' '), 90) AS b FROM messages ${id ? 'WHERE task_id=$1' : ''} ORDER BY id`, id ? [id] : []);
  for (const x of m.rows) console.log(`#${x.task_id ?? '-'} [${x.kind}] ${x.speaker}: ${x.b}`);
  const u = await query(`SELECT purpose, count(*)::int n, count(*) FILTER (WHERE NOT ok)::int fail FROM ai_usage ${id ? 'WHERE task_id=$1' : ''} GROUP BY purpose`, id ? [id] : []);
  console.table(u.rows);
  await pool.end();
})();
