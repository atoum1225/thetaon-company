// 기억 저장소(DB) 백업. 하루 한 번 backups 폴더에 저장하고 최근 14개만 남긴다.
// 백업 파일에는 업무 기록이 그대로 들어 있으므로 git·GitHub에는 올리지 않는다(.gitignore).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { dbConfig } = require('./db');

const PG_BIN = process.env.PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin';
const DIR = path.join(__dirname, '..', 'backups');
const KEEP = 14;

function run(exe, args) {
  return new Promise((resolve, reject) => {
    const cfg = dbConfig();
    const child = spawn(path.join(PG_BIN, exe), args, {
      env: { ...process.env, PGPASSWORD: cfg.password },
      windowsHide: true,
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${exe} 실패(코드 ${code}): ${err.slice(0, 300)}`))));
  });
}

function connArgs(database) {
  const c = dbConfig(database);
  return ['-h', c.host, '-p', String(c.port), '-U', c.user];
}

async function backupNow() {
  fs.mkdirSync(DIR, { recursive: true });
  const cfg = dbConfig();
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const file = path.join(DIR, `${cfg.database}-${stamp}.dump`);
  await run('pg_dump.exe', [...connArgs(), '-Fc', '-f', file, cfg.database]);
  const old = fs.readdirSync(DIR).filter((f) => f.startsWith(cfg.database + '-') && f.endsWith('.dump')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP))) fs.unlinkSync(path.join(DIR, f));
  return file;
}

function lastBackupAge() {
  const cfg = dbConfig();
  try {
    const files = fs.readdirSync(DIR).filter((f) => f.startsWith(cfg.database + '-') && f.endsWith('.dump'));
    if (!files.length) return Infinity;
    return Math.min(...files.map((f) => Date.now() - fs.statSync(path.join(DIR, f)).mtimeMs));
  } catch {
    return Infinity;
  }
}

// 서버가 켜져 있는 동안 한 시간마다 확인해서, 마지막 백업이 하루 넘었으면 새로 뜬다.
function startDailyBackup(log = console.log) {
  const check = async () => {
    if (lastBackupAge() < 24 * 3600 * 1000) return;
    try {
      const f = await backupNow();
      log(`[백업] ${path.basename(f)}`);
    } catch (err) {
      log(`[백업 실패] ${err.message}`);
    }
  };
  setTimeout(check, 10_000).unref();
  setInterval(check, 3600 * 1000).unref();
}

module.exports = { backupNow, startDailyBackup, run, connArgs, DIR };
