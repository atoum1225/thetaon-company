// 최종 보고서를 위키 문서로 옮기면 어떻게 되는지 미리 보기(저장하지 않음): node scripts/wiki-preview.js <업무번호>
const { query, pool } = require('../src/db');
const wiki = require('../src/wiki');

(async () => {
  const t = (await query('SELECT * FROM tasks WHERE id=$1', [Number(process.argv[2])])).rows[0];
  const p = wiki.plan(t);
  console.log('저장 위치:', p.rel);
  console.log('index.md 줄:', `- [[${p.name}]] — ${p.status === 'draft' ? '(draft) ' : ''}${p.summary}`);
  console.log('------------------------------------------');
  console.log(wiki.fileText(t, p));
  await pool.end();
})();
