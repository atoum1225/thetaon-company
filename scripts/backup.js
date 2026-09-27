// 백업을 지금 바로 뜨기: npm run backup
// 복원 시험(실제 DB는 건드리지 않음): npm run backup -- --test-restore
const path = require('path');
const { Client } = require('pg');
const { backupNow, run, connArgs } = require('../src/backup');
const { dbConfig, safeMessage } = require('../src/db');

(async () => {
  const file = await backupNow();
  console.log('백업 완료:', path.relative(process.cwd(), file));
  if (!process.argv.includes('--test-restore')) return;

  // 시험용 DB에 복원해 보고 표별 건수를 원본과 비교한 뒤, 시험용 DB는 지운다.
  const TEST_DB = 'thetaon_restore_check';
  const admin = new Client(dbConfig('postgres'));
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  try {
    await run('pg_restore.exe', [...connArgs(), '-d', TEST_DB, file]);
    const tables = ['employees', 'tasks', 'messages', 'meetings', 'decisions', 'advice', 'deliverables', 'staff_notes', 'company_facts', 'ai_usage'];
    const count = async (db) => {
      const c = new Client(dbConfig(db));
      await c.connect();
      const out = {};
      for (const t of tables) out[t] = (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
      await c.end();
      return out;
    };
    const a = await count(dbConfig().database);
    const b = await count(TEST_DB);
    const same = tables.every((t) => a[t] === b[t]);
    console.table(tables.map((t) => ({ 표: t, 원본: a[t], 복원본: b[t] })));
    console.log(same ? '복원 시험 통과: 원본과 건수가 같습니다.' : '복원 시험 실패: 건수가 다릅니다.');
    if (!same) process.exitCode = 1;
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.end();
  }
})().catch((err) => {
  console.error('실패:', safeMessage(err));
  process.exit(1);
});
