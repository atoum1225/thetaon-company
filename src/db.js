// PostgreSQL 접속. 비밀번호는 .env에서만 읽고, 오류 메시지에 절대 싣지 않는다.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Pool } = require('pg');

function dbConfig(database) {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: database || process.env.DB_NAME || 'thetaon_company',
  };
}

const pool = new Pool({ ...dbConfig(), max: 10 });
pool.on('error', (err) => console.error('[DB] 연결 오류:', safeMessage(err)));

// 오류 문장에서 비밀번호가 새지 않게 가린다.
function safeMessage(err) {
  let msg = String((err && err.message) || err);
  const pw = process.env.DB_PASSWORD;
  if (pw) msg = msg.split(pw).join('****');
  if (err && err.code === '28P01') return 'DB 비밀번호가 맞지 않습니다(.env의 DB_PASSWORD 확인).';
  if (err && err.code === 'ECONNREFUSED') return 'PostgreSQL에 연결할 수 없습니다(서비스가 켜져 있는지 확인).';
  if (/password must be a string/.test(msg)) return '.env 파일이 없거나 DB_PASSWORD 칸이 비어 있습니다.';
  if (err && err.code === '3D000') return '데이터베이스가 아직 없습니다(npm run db:init 먼저 실행).';
  return msg;
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query, dbConfig, safeMessage };
