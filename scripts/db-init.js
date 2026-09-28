// 데이터베이스와 표를 만든다. 여러 번 실행해도 안전하다(이미 있으면 건너뜀).
const { Client } = require('pg');
const { dbConfig, safeMessage } = require('../src/db');
const { EMPLOYEES } = require('../src/staff');
const { seed: seedRules } = require('../src/rules');

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS employees (
  id            SERIAL PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,
  name          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  provider      TEXT NOT NULL CHECK (provider IN ('claude','gemini')),
  model         TEXT NOT NULL,
  duty          TEXT NOT NULL,
  deliverables  TEXT NOT NULL,
  advisor_only  BOOLEAN NOT NULL DEFAULT false,
  active        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS tasks (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  instruction   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT '접수'
                CHECK (status IN ('접수','회의중','승인대기','수행중','검수중','전략조언','완료','일시정지','한도대기','실패')),
  step          INT  NOT NULL DEFAULT 1,
  paused_status TEXT,
  definition    JSONB,
  deadline      TEXT,
  reject_count  INT  NOT NULL DEFAULT 0,
  rework_count  INT  NOT NULL DEFAULT 0,
  final_report  TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS task_events (
  id          SERIAL PRIMARY KEY,
  task_id     INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meetings (
  id              SERIAL PRIMARY KEY,
  task_id         INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt         INT NOT NULL DEFAULT 1,
  attendees       TEXT[] NOT NULL DEFAULT '{}',
  rounds          INT NOT NULL DEFAULT 0,
  minutes         TEXT,
  assignment_plan JSONB,
  review_criteria TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  task_id     INT REFERENCES tasks(id) ON DELETE CASCADE,
  meeting_id  INT REFERENCES meetings(id) ON DELETE SET NULL,
  speaker     TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT '발언' CHECK (kind IN ('발언','CEO','시스템')),
  body        TEXT NOT NULL,
  handled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decisions (
  id               SERIAL PRIMARY KEY,
  task_id          INT REFERENCES tasks(id) ON DELETE SET NULL,
  content          TEXT NOT NULL,
  rationale        TEXT,
  decided_by       TEXT NOT NULL,
  review_condition TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS advice (
  id          SERIAL PRIMARY KEY,
  task_id     INT REFERENCES tasks(id) ON DELETE SET NULL,
  content     TEXT NOT NULL,
  adopted     TEXT CHECK (adopted IN ('반영','일부 반영','미반영')),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deliverables (
  id            SERIAL PRIMARY KEY,
  task_id       INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id   INT REFERENCES employees(id),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  version       INT NOT NULL DEFAULT 1,
  review_result TEXT CHECK (review_result IN ('통과','미달')),
  review_note   TEXT,
  forbidden_hits JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_notes (
  id          SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  task_id     INT REFERENCES tasks(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_facts (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL,
  key         TEXT NOT NULL,
  content     TEXT NOT NULL,
  pattern     TEXT,
  source      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category, key)
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id            SERIAL PRIMARY KEY,
  task_id       INT REFERENCES tasks(id) ON DELETE SET NULL,
  employee_id   INT REFERENCES employees(id),
  provider      TEXT NOT NULL,
  model         TEXT,
  purpose       TEXT,
  ok            BOOLEAN NOT NULL,
  duration_ms   INT,
  input_tokens  INT,
  output_tokens INT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_log (
  id          SERIAL PRIMARY KEY,
  event       TEXT NOT NULL,
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meetings     ADD COLUMN IF NOT EXISTS turn INT NOT NULL DEFAULT 0;
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS assignment_idx INT NOT NULL DEFAULT 0;
ALTER TABLE tasks        ADD COLUMN IF NOT EXISTS wiki_draft JSONB;
ALTER TABLE tasks        ADD COLUMN IF NOT EXISTS wiki_path TEXT;
ALTER TABLE tasks        ADD COLUMN IF NOT EXISTS wiki_saved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_trgm     ON tasks        USING gin ((title || ' ' || instruction) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_decisions_trgm  ON decisions    USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_advice_trgm     ON advice       USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_deliv_trgm      ON deliverables USING gin ((title || ' ' || body) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_task   ON messages (task_id, id);
`;

async function main() {
  const cfg = dbConfig();

  // 1) 데이터베이스가 없으면 만든다.
  const admin = new Client(dbConfig('postgres'));
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [cfg.database]);
  if (exists.rowCount === 0) {
    if (!/^[a-z_][a-z0-9_]*$/.test(cfg.database)) throw new Error('DB 이름은 영문 소문자·숫자·밑줄만 쓸 수 있습니다.');
    await admin.query(`CREATE DATABASE ${cfg.database} ENCODING 'UTF8'`);
    console.log(`데이터베이스 ${cfg.database} 를 새로 만들었습니다.`);
  } else {
    console.log(`데이터베이스 ${cfg.database} 가 이미 있습니다.`);
  }
  await admin.end();

  // 2) 표를 만들고 직원 명부를 채운다.
  const db = new Client(cfg);
  await db.connect();
  await db.query(SCHEMA);
  for (const e of EMPLOYEES) {
    await db.query(
      `INSERT INTO employees (key, name, title, provider, model, duty, deliverables, advisor_only)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, title=EXCLUDED.title, provider=EXCLUDED.provider,
         duty=EXCLUDED.duty, deliverables=EXCLUDED.deliverables, advisor_only=EXCLUDED.advisor_only`,
      [e.key, e.name, e.title, e.provider, e.model, e.duty, e.deliverables, e.advisorOnly]
    );
  }
  await seedRules(db);
  await db.query(`INSERT INTO system_log (event, message) VALUES ('db-init', '표 점검·직원 명부·금지 수치 목록 갱신')`);
  const n = await db.query('SELECT count(*)::int AS n FROM employees');
  console.log(`표 준비 완료. 직원 ${n.rows[0].n}명 등록.`);
  await db.end();
}

main().catch((err) => {
  console.error('실패:', safeMessage(err));
  process.exit(1);
});
