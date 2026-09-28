// 최종 보고서를 HTML 파일로 저장: node scripts/report-file.js <업무번호> <저장할 파일>
const fs = require('fs');
const { reportHtml } = require('../src/report');
const { pool } = require('../src/db');

(async () => {
  const [id, out] = process.argv.slice(2);
  const html = await reportHtml(Number(id));
  if (!html) throw new Error('최종 보고서가 없습니다.');
  fs.writeFileSync(out, html, 'utf8');
  console.log('저장:', out);
  await pool.end();
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
