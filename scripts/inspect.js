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
  if (process.argv.includes('--report')) {
    const done = await query(`SELECT id, title, final_report FROM tasks WHERE final_report IS NOT NULL ${id ? 'AND id=$1' : ''} ORDER BY id`, id ? [id] : []);
    for (const t of done.rows) {
      console.log(`\n==================== #${t.id} ${t.title} ====================\n${t.final_report}`);
      const d = await query(`SELECT v.title, v.version, v.review_result, v.review_note, v.forbidden_hits, e.name FROM deliverables v LEFT JOIN employees e ON e.id=v.employee_id WHERE task_id=$1 ORDER BY assignment_idx, version`, [t.id]);
      console.log('\n--- 산출물·검수 ---');
      for (const x of d.rows) console.log(`${x.name} | ${x.title} v${x.version} | ${x.review_result} | 걸린 표현: ${(x.forbidden_hits || []).map((h) => `${h.level}:${h.match}`).join(', ') || '-'}\n   ${String(x.review_note || '').slice(0, 300)}`);
      const a = await query(`SELECT content, adopted, reason FROM advice WHERE task_id=$1`, [t.id]);
      console.log('\n--- 쫑전략 조언 ---');
      for (const x of a.rows) console.log(`${x.content}\n=> ${x.adopted}: ${x.reason}`);
    }
  }
  if (process.argv.includes('--calls')) {
    const c = await query(
      `SELECT u.purpose, e.name, u.model, round(u.duration_ms / 1000.0) AS sec, u.input_tokens AS tin, u.output_tokens AS tout, u.ok
       FROM ai_usage u JOIN employees e ON e.id = u.employee_id ${id ? 'WHERE u.task_id=$1' : ''} ORDER BY u.id`, id ? [id] : []);
    console.table(c.rows);
  }
  await pool.end();
})();
