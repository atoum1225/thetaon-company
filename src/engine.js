// 업무 진행기. 계획서의 10단계를 순서대로 진행하고, CEO 승인(⑥)에서 멈춘다.
// 한 번에 AI 호출 하나씩만 한다(구독 사용량 절약). 단계마다 진행 위치가 DB에 남아서 서버를 껐다 켜도 이어진다.
const { query, safeMessage } = require('./db');
const { ask } = require('./company');
const bus = require('./bus');
const rules = require('./rules');
const memory = require('./memory');

const ACTIVE = ['접수', '회의중', '수행중', '검수중', '전략조언'];
// 승인대기도 멈출 수 있다. 다시 진행하면 승인대기로 돌아간다.
const PAUSABLE = [...ACTIVE, '승인대기', '한도대기'];
const STAFF = ['황기획', '송개발', '서영업'];
const MAX_ROUNDS = 3;
const MAX_REWORK = 2;
const STOP_RE = /멈춰|멈추|중지|스톱|\bstop\b/i;

// ───────── 기본 도구 ─────────
async function getTask(id) {
  const r = await query('SELECT * FROM tasks WHERE id=$1', [id]);
  return r.rows[0] || null;
}

// force=false이면: 진행 중에 대표님이 일시정지를 눌렀을 때 진행기가 상태를 덮어쓰지 않고,
// 다음에 이어갈 상태로만 기억해 둔다.
async function setTask(id, fields, force = false) {
  fields = { ...fields };
  if (!force && fields.status && fields.status !== '일시정지') {
    const cur = await query('SELECT status FROM tasks WHERE id=$1', [id]);
    if (cur.rows[0]?.status === '일시정지') {
      fields.paused_status = fields.status;
      delete fields.status;
    }
  }
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(', ');
  await query(`UPDATE tasks SET ${sets}, updated_at=now() WHERE id=$1`, [id, ...keys.map((k) => fields[k])]);
  const t = await getTask(id);
  bus.emit('task', { id: t.id, status: t.status, title: t.title, step: t.step });
  return t;
}

async function event(taskId, kind, actor, detail = null) {
  await query('INSERT INTO task_events (task_id, kind, actor, detail) VALUES ($1,$2,$3,$4)', [taskId, kind, actor, detail]);
}

async function post(taskId, speaker, body, kind = '발언', meetingId = null) {
  const r = await query(
    `INSERT INTO messages (task_id, meeting_id, speaker, kind, body) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [taskId, meetingId, speaker, kind, String(body).trim()]
  );
  bus.emit('message', r.rows[0]);
  return r.rows[0];
}

async function latestMeeting(taskId) {
  const r = await query('SELECT * FROM meetings WHERE task_id=$1 ORDER BY attempt DESC LIMIT 1', [taskId]);
  return r.rows[0] || null;
}

async function rejectReasons(taskId) {
  const r = await query(`SELECT detail, created_at FROM task_events WHERE task_id=$1 AND kind='반려' ORDER BY id`, [taskId]);
  return r.rows.map((x, i) => `${i + 1}차 반려 사유: ${x.detail}`).join('\n');
}

async function transcript(taskId, since = null, maxChars = 18000) {
  const r = await query(
    `SELECT speaker, kind, body FROM messages WHERE task_id=$1 AND ($2::timestamptz IS NULL OR created_at >= $2) ORDER BY id`,
    [taskId, since]
  );
  let lines = r.rows.map((m) => (m.kind === '시스템' ? `(알림) ${m.body}` : m.kind === 'CEO' ? `CEO(대표님): ${m.body}` : `${m.speaker}: ${m.body}`));
  let text = lines.join('\n\n');
  while (text.length > maxChars && lines.length > 5) { lines = lines.slice(1); text = lines.join('\n\n'); }
  return text || '(아직 대화 없음)';
}

async function ceoTalk(taskId) {
  const r = await query(`SELECT body, created_at FROM messages WHERE task_id=$1 AND kind='CEO' ORDER BY id`, [taskId]);
  return r.rows.length ? r.rows.map((m) => `- ${m.body}`).join('\n') : '(없음)';
}

function defText(t) {
  const d = t.definition || {};
  return [
    `업무 #${t.id}: ${t.title}`,
    `CEO 지시 원문: ${t.instruction}`,
    d.goal ? `목표: ${d.goal}` : '',
    d.scope ? `범위: ${d.scope}` : '',
    `마감: ${t.deadline || d.deadline || '미정'}`,
    d.references?.length ? `참고한 과거 기록: ${d.references.join(', ')}` : '',
    d.conflicts?.length ? `이전 결정과 다를 수 있는 점: ${d.conflicts.join(' / ')}` : '',
  ].filter(Boolean).join('\n');
}

function planText(plan) {
  if (!plan) return '(없음)';
  const d = (plan.decisions || []).map((x, i) => `${i + 1}. ${x.content}${x.rationale ? ` (근거: ${x.rationale})` : ''}`).join('\n');
  const a = (plan.assignments || []).map((x, i) => `${i + 1}. ${x.employee} — ${x.title}: ${x.description}`).join('\n');
  return `[결정사항]\n${d || '(없음)'}\n\n[업무 배정]\n${a || '(없음)'}`;
}

async function latestDeliverables(taskId, since) {
  const r = await query(
    `SELECT DISTINCT ON (assignment_idx) v.*, e.name AS employee_name
     FROM deliverables v LEFT JOIN employees e ON e.id = v.employee_id
     WHERE v.task_id=$1 AND v.created_at >= $2
     ORDER BY assignment_idx, version DESC`,
    [taskId, since]
  );
  return r.rows;
}

function cut(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '\n…(이하 생략)' : s;
}

// ───────── 스키마 ─────────
const S = {
  define: {
    type: 'object',
    properties: {
      title: { type: 'string' }, goal: { type: 'string' }, scope: { type: 'string' }, deadline: { type: 'string' },
      attendees: { type: 'array', items: { type: 'string', enum: STAFF }, minItems: 1 },
      references: { type: 'array', items: { type: 'string' } },
      conflicts: { type: 'array', items: { type: 'string' } },
      opening: { type: 'string' },
    },
    required: ['title', 'goal', 'scope', 'deadline', 'attendees', 'references', 'conflicts', 'opening'],
  },
  chair: {
    type: 'object',
    properties: { continue: { type: 'boolean' }, comment: { type: 'string' } },
    required: ['continue', 'comment'],
  },
  minutes: {
    type: 'object',
    properties: {
      minutes: { type: 'string' },
      decisions: { type: 'array', items: { type: 'object', properties: { content: { type: 'string' }, rationale: { type: 'string' } }, required: ['content', 'rationale'] } },
      assignments: {
        type: 'array', minItems: 1,
        items: { type: 'object', properties: { employee: { type: 'string', enum: STAFF }, title: { type: 'string' }, description: { type: 'string' } }, required: ['employee', 'title', 'description'] },
      },
      review_criteria: { type: 'string' },
    },
    required: ['minutes', 'decisions', 'assignments', 'review_criteria'],
  },
  review: {
    type: 'object',
    properties: { result: { type: 'string', enum: ['통과', '미달'] }, note: { type: 'string' } },
    required: ['result', 'note'],
  },
  advise: {
    type: 'object',
    properties: { advice: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } } },
    required: ['advice', 'risks'],
  },
  adopt: {
    type: 'object',
    properties: { adopted: { type: 'string', enum: ['반영', '일부 반영', '미반영'] }, reason: { type: 'string' } },
    required: ['adopted', 'reason'],
  },
  final: {
    type: 'object',
    properties: {
      report: { type: 'string' },
      staff_notes: { type: 'array', items: { type: 'object', properties: { employee: { type: 'string' }, note: { type: 'string' } }, required: ['employee', 'note'] } },
    },
    required: ['report', 'staff_notes'],
  },
};

// ───────── 단계 ─────────
const STEPS = {
  // ① 접수
  1: async (t) => {
    await event(t.id, '접수', 'CEO', t.instruction);
    await post(t.id, '시스템', `업무 #${t.id}을 접수했습니다. 김비서가 과제를 정리합니다.`, '시스템');
    await setTask(t.id, { step: 2 });
  },

  // ② 과제 정의 (과거 기록 자동 참고)
  2: async (t) => {
    const records = await memory.searchRecords(t.instruction, { excludeTaskId: t.id });
    const wiki = memory.wikiCandidates(t.instruction);
    const prompt = `[CEO 지시]\n${t.instruction}\n\n[회사 기본 정보]\n${await rules.companyText()}\n\n` +
      `[관련 과거 기록(본부 DB)]\n${memory.recordsText(records)}\n\n` +
      `[관련 위키 문서 후보(C:\\ThetaRO, 읽기 전용)]\n${memory.wikiText(wiki)}\n` +
      `필요하면 위 경로의 파일을 열어 확인한다. index.md나 log.md 전체를 읽지는 않는다.\n\n` +
      `[할 일]\n목표·범위·마감을 정리하고, 회의에 부를 담당자를 황기획·송개발·서영업 중 필요한 사람만 고른다(쫑전략은 조언자로 자동 참석).\n` +
      `참고한 과거 기록과 위키 문서를 references에 적는다(예: "결정 #3", "위키: kepco-proposal"). 없으면 빈 목록.\n` +
      `이전 결정과 다른 방향이 필요해 보이면 conflicts에 적는다. 없으면 빈 목록.\n` +
      `지시에 마감이 없으면 deadline은 "미정(CEO 확인 필요)".\n` +
      `title은 20자 안팎의 업무 이름. opening은 회의를 여는 첫 발언(3~5문장, 참석자에게 무엇을 논의할지 말한다).`;
    const r = await ask('김비서', { taskId: t.id, purpose: 'define', prompt, schema: S.define });
    const d = r.json;
    d.attendees = [...new Set((d.attendees || []).filter((a) => STAFF.includes(a)))];
    if (!d.attendees.length) d.attendees = ['황기획'];
    d.memory = { records: records.map((x) => `${x.kind} #${x.id}`), wiki: wiki.map((w) => w.name) };
    await setTask(t.id, { title: d.title || t.title, definition: d, deadline: d.deadline, status: '회의중', step: 3 });
    await event(t.id, '과제 정의', '김비서', `${d.goal} / 참석: ${d.attendees.join(', ')}`);
    if (d.conflicts?.length) {
      await post(t.id, '시스템', `이전 결정과 다를 수 있는 점이 있습니다. 승인 전에 확인해 주세요.\n- ${d.conflicts.join('\n- ')}`, '시스템');
    }
  },

  // ③ 회의 소집
  3: async (t) => {
    const prev = await latestMeeting(t.id);
    const attempt = prev ? prev.attempt + 1 : 1;
    const attendees = t.definition?.attendees?.length ? t.definition.attendees : ['황기획'];
    const m = await query(
      `INSERT INTO meetings (task_id, attempt, attendees) VALUES ($1,$2,$3) RETURNING *`,
      [t.id, attempt, [...attendees, '쫑전략']]
    );
    const mid = m.rows[0].id;
    await post(t.id, '시스템', `${attempt}차 회의를 시작합니다. 참석: 김비서, ${attendees.join(', ')}, 쫑전략(조언자)`, '시스템', mid);
    if (attempt === 1) {
      await post(t.id, '김비서', t.definition?.opening || `업무 "${t.title}"에 대해 의견 부탁드립니다.`, '발언', mid);
    } else {
      const last = await query(`SELECT detail FROM task_events WHERE task_id=$1 AND kind='반려' ORDER BY id DESC LIMIT 1`, [t.id]);
      await post(t.id, '김비서', `대표님이 배정안을 반려하셨습니다. 사유는 "${last.rows[0]?.detail || '(사유 없음)'}"입니다. 이 사유를 반영해서 다시 논의하겠습니다.`, '발언', mid);
    }
    await event(t.id, '회의 소집', '김비서', `${attempt}차`);
    await setTask(t.id, { step: 4 });
  },

  // ④ 토론 (최대 3라운드). 한 번 호출에 발언 하나.
  4: async (t) => {
    const m = await latestMeeting(t.id);
    const attendees = m.attendees.filter((a) => a !== '쫑전략');
    const speakers = [...attendees, '쫑전략', '김비서'];
    const round = m.rounds + 1;
    const speaker = speakers[m.turn];
    const conclude = async () => {
      await query('UPDATE meetings SET rounds=$2, turn=0 WHERE id=$1', [m.id, round]);
      await setTask(t.id, { step: 5 });
    };
    if (!speaker) return conclude();

    const base = `${defText(t)}\n\n${(await rejectReasons(t.id)) || ''}\n\n[지금까지 회의 대화]\n${await transcript(t.id, m.created_at)}`;

    if (speaker === '김비서') {
      if (round >= MAX_ROUNDS) return conclude();
      const r = await ask('김비서', {
        taskId: t.id, purpose: 'chair', schema: S.chair,
        prompt: `${base}\n\n[할 일]\n${round}라운드가 끝났다(최대 ${MAX_ROUNDS}라운드). 업무 배정안을 만들 만큼 논의가 됐으면 continue=false, 더 논의가 필요하면 true.\ncomment는 회의 진행자로서 짧게 한마디(다음 라운드에서 무엇을 좁힐지, 또는 정리하겠다는 말).`,
      });
      await post(t.id, '김비서', r.json.comment, '발언', m.id);
      if (!r.json.continue) return conclude();
      await query('UPDATE meetings SET rounds=$2, turn=0 WHERE id=$1', [m.id, round]);
      return;
    }

    if (speaker === '쫑전략') {
      const r = await ask('쫑전략', {
        taskId: t.id, purpose: 'advise_meeting',
        prompt: `${base}\n\n${await rules.rulesText()}\n\n[할 일]\n${round}라운드 조언자 발언. 논의에서 금지 수치나 조건 없는 수치가 쓰일 위험, 사업 리스크를 짚는다. 3~6문장. 결정하지 말고 권고로 말한다.`,
      });
      await post(t.id, '쫑전략', r.text, '발언', m.id);
    } else {
      const r = await ask(speaker, {
        taskId: t.id, purpose: 'speak',
        prompt: `${base}\n\n[할 일]\n지금은 ${round}라운드(최대 ${MAX_ROUNDS}), 네 차례다. 자기 담당 관점에서 의견을 낸다. 앞사람 말에 반응하고, 할 수 있는 일과 필요한 것을 구체적으로. 4~8문장. 결정은 김비서와 CEO가 한다.\n위키 근거가 필요하면 C:\\ThetaRO 파일을 열어 확인해도 된다.`,
      });
      await post(t.id, speaker, r.text, '발언', m.id);
    }
    await query('UPDATE meetings SET turn=turn+1 WHERE id=$1', [m.id]);
  },

  // ⑤ 회의록·결정·배정안
  5: async (t) => {
    const m = await latestMeeting(t.id);
    const r = await ask('김비서', {
      taskId: t.id, purpose: 'minutes', schema: S.minutes,
      prompt: `${defText(t)}\n\n${(await rejectReasons(t.id)) || ''}\n\n[회의 대화]\n${await transcript(t.id, m.created_at)}\n\n` +
        `[할 일]\n회의록(minutes, 논의 흐름 요약 5~10문장), 결정사항(decisions, 근거 포함), 업무 배정(assignments: 담당자는 이번 회의 참석자(${m.attendees.filter((a) => a !== '쫑전략').join(', ')}) 중에서 고르는 것이 원칙이고, 꼭 다른 직원이 필요하면 회의록에 이유를 적는다. 각자 무엇을 만들지 구체적으로), ` +
        `검수 기준(review_criteria: 김비서가 결과물을 통과/미달로 판정할 기준을 번호로)을 만든다. 금지 수치 검사 통과는 기준에 항상 넣는다.` +
        (t.reject_count ? '\n반려 사유를 어떻게 반영했는지 회의록에 적는다.' : ''),
    });
    const j = r.json;
    j.assignments = j.assignments.filter((a) => STAFF.includes(a.employee));
    // 회의에 없던 직원이 배정받으면 사정을 모른 채 일하게 되므로, 승인 화면에서 보이게 표시한다.
    const absent = [...new Set(j.assignments.map((a) => a.employee).filter((e) => !m.attendees.includes(e)))];
    if (absent.length) j.minutes += `\n\n(참고: ${absent.join(', ')}은 회의에 참석하지 않았지만 배정에 포함됐습니다.)`;
    if (!j.assignments.length) throw new Error('배정안에 담당자가 없습니다.');
    await query('UPDATE meetings SET minutes=$2, assignment_plan=$3, review_criteria=$4 WHERE id=$1',
      [m.id, j.minutes, { decisions: j.decisions, assignments: j.assignments }, j.review_criteria]);
    await post(t.id, '김비서', `회의 정리했습니다. 결정 ${j.decisions.length}건, 배정 ${j.assignments.length}건입니다. 대표님, 업무 화면에서 배정안을 보시고 승인이나 반려를 눌러 주세요.`, '발언', m.id);
    await event(t.id, '배정안 작성', '김비서');
    await setTask(t.id, { status: '승인대기', step: 6 });
  },

  // ⑦ 담당자별 수행. 한 번 호출에 산출물 하나.
  7: async (t) => {
    const m = await latestMeeting(t.id);
    const plan = m.assignment_plan;
    const latest = await latestDeliverables(t.id, m.created_at);
    const byIdx = new Map(latest.map((d) => [d.assignment_idx, d]));
    const idx = plan.assignments.findIndex((a, i) => {
      const d = byIdx.get(i);
      return !d || (d.review_result === '미달' && d.version < t.rework_count + 1);
    });
    if (idx < 0) {
      await setTask(t.id, { status: '검수중', step: 8 });
      return;
    }
    const a = plan.assignments[idx];
    const prev = byIdx.get(idx);
    const rework = prev
      ? `\n\n[재작업 요청]\n이전 판(v${prev.version})이 검수에서 미달이었다. 지적 사항을 모두 고쳐 새 판 전체를 다시 쓴다.\n검수 의견: ${prev.review_note}\n금지 수치 검사: ${rules.hitsText(prev.forbidden_hits)}\n\n[이전 판]\n${cut(prev.body, 8000)}`
      : '';
    const r = await ask(a.employee, {
      taskId: t.id, purpose: 'work',
      prompt: `${defText(t)}\n\n${planText(plan)}\n\n[검수 기준]\n${m.review_criteria}\n\n[대표님 말씀]\n${await ceoTalk(t.id)}\n\n` +
        `${await rules.rulesText()}\n\n[네가 맡은 일]\n${a.title}: ${a.description}${rework}\n\n` +
        `[쓰는 방법]\n산출물 본문만 마크다운으로 쓴다(인사말 없이). 수치나 사실에는 근거 문서를 괄호로 붙이고, 근거가 없으면 "미확인"이라고 쓴다. 위키 근거가 필요하면 C:\\ThetaRO 파일을 열어 확인한다.`,
    });
    const version = prev ? prev.version + 1 : 1;
    await query(
      `INSERT INTO deliverables (task_id, employee_id, assignment_idx, title, body, version) VALUES ($1,$2,$3,$4,$5,$6)`,
      [t.id, r.emp.id, idx, a.title, r.text, version]
    );
    await post(t.id, a.employee, `"${a.title}" ${version > 1 ? `수정본(v${version})` : '초안'} 올렸습니다.`);
  },

  // ⑧ 김비서 1차 검수. 한 번 호출에 산출물 하나.
  8: async (t) => {
    const m = await latestMeeting(t.id);
    const latest = await latestDeliverables(t.id, m.created_at);
    const d = latest.find((x) => !x.review_result);
    if (d) {
      const hits = await rules.scan(d.body);
      const forbidden = hits.filter((h) => h.level === 'forbidden');
      let result;
      let note;
      if (forbidden.length) {
        result = '미달';
        note = `금지 수치·표현이 들어 있습니다: ${forbidden.map((h) => `"${h.match}"(${h.key})`).join(', ')}. 빼거나 허용된 표현으로 바꿔 주세요.`;
      } else {
        const r = await ask('김비서', {
          taskId: t.id, purpose: 'review', schema: S.review,
          prompt: `${defText(t)}\n\n[검수 기준]\n${m.review_criteria}\n\n[배정 내용]\n${m.assignment_plan.assignments[d.assignment_idx]?.description || d.title}\n\n` +
            `[자동 검사에서 조건 확인이 필요한 수치]\n${rules.hitsText(hits)}\n\n[산출물: ${d.title} v${d.version}, ${d.employee_name}]\n${cut(d.body, 12000)}\n\n` +
            `[할 일]\n검수 기준에 맞춰 통과/미달을 판정한다. 조건부 수치가 조건 없이 쓰였으면 미달. note에는 판정 이유와 고칠 점을 구체적으로 적는다.`,
        });
        result = r.json.result;
        note = r.json.note;
      }
      await query('UPDATE deliverables SET review_result=$2, review_note=$3, forbidden_hits=$4 WHERE id=$1', [d.id, result, note, JSON.stringify(hits)]);
      await post(t.id, '김비서', `검수: "${d.title}" v${d.version} — ${result}. ${note}`);
      return;
    }
    const failed = latest.filter((x) => x.review_result === '미달');
    if (!failed.length) {
      await event(t.id, '검수 통과', '김비서');
      await setTask(t.id, { status: '전략조언', step: 9 });
    } else if (t.rework_count < MAX_REWORK) {
      await event(t.id, '재작업', '김비서', failed.map((x) => x.title).join(', '));
      await setTask(t.id, { status: '수행중', step: 7, rework_count: t.rework_count + 1 });
    } else {
      await event(t.id, '재작업 한도', '김비서', failed.map((x) => x.title).join(', '));
      await post(t.id, '시스템', `재작업을 ${MAX_REWORK}회 했는데도 미달인 산출물이 있습니다(${failed.map((x) => x.title).join(', ')}). 대표님이 확인하신 뒤 "다시 진행"을 누르면 지금 상태 그대로 전략 조언 단계로 넘어갑니다.`, '시스템');
      await setTask(t.id, { status: '일시정지', paused_status: '전략조언', step: 9 });
    }
  },

  // ⑨ 쫑전략 조언 → 김비서가 반영 여부 기록
  9: async (t) => {
    const m = await latestMeeting(t.id);
    const latest = await latestDeliverables(t.id, m.created_at);
    const pending = await query(`SELECT * FROM advice WHERE task_id=$1 AND created_at >= $2 ORDER BY id DESC LIMIT 1`, [t.id, m.created_at]);
    const docs = latest.map((d) => `### ${d.title} v${d.version} (${d.employee_name}, 검수 ${d.review_result})\n${cut(d.body, 6000)}\n자동 검사: ${rules.hitsText(d.forbidden_hits)}`).join('\n\n');

    if (!pending.rows[0]) {
      const r = await ask('쫑전략', {
        taskId: t.id, purpose: 'advise', schema: S.advise,
        prompt: `${defText(t)}\n\n${planText(m.assignment_plan)}\n\n${await rules.rulesText()}\n\n[산출물]\n${docs}\n\n` +
          `[할 일]\n산출물 전체를 보고 금지 수치 기준과 리스크 관점에서 조언한다. advice는 조언 본문(5~12문장, 권고형), risks는 짧은 리스크 목록. 결정하지 않는다.`,
      });
      const content = `${r.json.advice}${r.json.risks?.length ? `\n\n리스크:\n- ${r.json.risks.join('\n- ')}` : ''}`;
      await query('INSERT INTO advice (task_id, content) VALUES ($1,$2)', [t.id, content]);
      await post(t.id, '쫑전략', content);
      return;
    }
    const adv = pending.rows[0];
    const r = await ask('김비서', {
      taskId: t.id, purpose: 'adopt', schema: S.adopt,
      prompt: `${defText(t)}\n\n[산출물 요약]\n${latest.map((d) => `- ${d.title} v${d.version}: 검수 ${d.review_result}`).join('\n')}\n\n[쫑전략 조언(참고 의견)]\n${adv.content}\n\n` +
        `[할 일]\n이 조언을 최종 보고에 반영할지 정한다(반영/일부 반영/미반영). reason에 이유를 적는다. 조언은 참고 의견일 뿐이고 결정은 네가 한다.`,
    });
    await query('UPDATE advice SET adopted=$2, reason=$3 WHERE id=$1', [adv.id, r.json.adopted, r.json.reason]);
    await post(t.id, '김비서', `쫑전략 조언은 "${r.json.adopted}"하겠습니다. ${r.json.reason}`);
    await event(t.id, '전략 조언 반영 판단', '김비서', r.json.adopted);
    await setTask(t.id, { step: 10 });
  },

  // ⑩ 최종 보고서
  10: async (t) => {
    const m = await latestMeeting(t.id);
    const latest = await latestDeliverables(t.id, m.created_at);
    const adv = await query(`SELECT * FROM advice WHERE task_id=$1 ORDER BY id DESC LIMIT 1`, [t.id]);
    const a = adv.rows[0];
    const docs = latest.map((d) => `### ${d.title} v${d.version} (${d.employee_name}) — 검수 ${d.review_result}: ${d.review_note}\n${cut(d.body, 5000)}`).join('\n\n');
    const r = await ask('김비서', {
      taskId: t.id, purpose: 'final', schema: S.final,
      prompt: `${defText(t)}\n\n${planText(m.assignment_plan)}\n\n[대표님 말씀]\n${await ceoTalk(t.id)}\n\n[반려 ${t.reject_count}회, 재작업 ${t.rework_count}회]\n\n` +
        `[산출물]\n${docs}\n\n[쫑전략 조언(참고 의견)]\n${a?.content || '(없음)'}\n반영 여부: ${a?.adopted || '-'} / 이유: ${a?.reason || '-'}\n\n` +
        `${await rules.rulesText()}\n\n[할 일]\nCEO에게 올릴 최종 보고서를 마크다운으로 쓴다. 순서: 요약(3~5문장), 결정사항, 산출물별 결과, 검수 결과, 전략 조언과 반영 여부·이유, 남은 과제와 대표님이 확인하실 것.\n` +
        `산출물 본문을 그대로 다 옮기지 말고 요점만. 금지 수치는 쓰지 않는다.\nstaff_notes에는 다음 업무에 이어 쓸 직원별 메모를 적는다(참여한 직원만, 한두 문장).`,
    });
    let report = r.json.report;
    const hits = (await rules.scan(report)).filter((h) => h.level === 'forbidden');
    if (hits.length) report += `\n\n---\n자동 검사 경고: 보고서에 금지 표현이 있습니다 — ${hits.map((h) => `"${h.match}"`).join(', ')}. 대외 사용 전에 고쳐야 합니다.`;
    for (const n of r.json.staff_notes || []) {
      const e = await query('SELECT id FROM employees WHERE name=$1', [n.employee]);
      if (e.rows[0]) await query('INSERT INTO staff_notes (employee_id, task_id, body) VALUES ($1,$2,$3)', [e.rows[0].id, t.id, n.note]);
    }
    await setTask(t.id, { final_report: report, status: '완료', step: 11, completed_at: new Date() });
    await event(t.id, '완료', '김비서');
    await post(t.id, '김비서', '대표님, 최종 보고서 올렸습니다. 업무 화면에서 보실 수 있습니다.');
  },
};

// ───────── CEO 끼어들기 ─────────
async function handleInterrupts(t) {
  const r = await query(`SELECT * FROM messages WHERE task_id=$1 AND kind='CEO' AND handled=false ORDER BY id`, [t.id]);
  if (!r.rows.length) return null;
  const ids = r.rows.map((x) => x.id);
  if (r.rows.some((x) => STOP_RE.test(x.body)) && PAUSABLE.includes(t.status)) {
    await query('UPDATE messages SET handled=true WHERE id = ANY($1)', [ids]);
    await setTask(t.id, { status: '일시정지', paused_status: t.status });
    await event(t.id, '일시정지', 'CEO');
    await post(t.id, '시스템', '대표님 지시로 일시정지했습니다. "다시 진행"을 누르면 멈춘 곳부터 이어서 합니다.', '시스템');
    return 'paused';
  }
  const rr = await ask('김비서', {
    taskId: t.id, purpose: 'reply_ceo',
    prompt: `${defText(t)}\n현재 상태: ${t.status}\n\n[최근 대화]\n${await transcript(t.id, null, 8000)}\n\n[대표님이 방금 하신 말]\n${r.rows.map((x) => x.body).join('\n')}\n\n` +
      `[할 일]\n대표님 말씀에 바로 답한다(2~5문장). 지시면 어떻게 반영할지, 질문이면 아는 만큼 답한다. 반영은 이후 발언과 작업에서 한다. 배정안 승인·반려는 화면의 버튼으로 해 주셔야 한다고 필요하면 안내한다.`,
  });
  await query('UPDATE messages SET handled=true WHERE id = ANY($1)', [ids]);
  await post(t.id, '김비서', rr.text);
  return 'replied';
}

// 업무와 무관한 일반 대화(task_id 없음)에 김비서가 답한다.
async function replyGeneral() {
  const r = await query(`SELECT * FROM messages WHERE task_id IS NULL AND kind='CEO' AND handled=false ORDER BY id`);
  if (!r.rows.length) return;
  const recent = await query(`SELECT speaker, kind, body FROM messages WHERE task_id IS NULL ORDER BY id DESC LIMIT 20`);
  const tasks = await query(`SELECT id, title, status FROM tasks ORDER BY id DESC LIMIT 10`);
  const rr = await ask('김비서', {
    purpose: 'reply_ceo',
    prompt: `[최근 업무]\n${tasks.rows.map((x) => `#${x.id} ${x.title} (${x.status})`).join('\n') || '(없음)'}\n\n[일반 대화]\n${recent.rows.reverse().map((m) => `${m.kind === 'CEO' ? 'CEO(대표님)' : m.speaker}: ${m.body}`).join('\n')}\n\n` +
      `[할 일]\n대표님 말씀에 답한다(2~5문장). 새 업무 지시로 보이면 업무 화면의 지시 입력창에 넣어 주시면 바로 시작한다고 안내한다.`,
  });
  await query('UPDATE messages SET handled=true WHERE id = ANY($1)', [r.rows.map((x) => x.id)]);
  await post(null, '김비서', rr.text);
}

// ───────── 실행 대기열 (한 번에 하나) ─────────
const queue = [];
let busy = false;
let current = null;

function schedule(taskId, mode = 'run') {
  if (!queue.some((q) => q.taskId === taskId && q.mode === mode)) queue.push({ taskId, mode });
  pump();
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    current = job.taskId;
    try {
      if (job.taskId === null) await replyGeneral();
      else if (job.mode === 'reply') await replyOnly(job.taskId);
      else await runTask(job.taskId);
    } catch (err) {
      console.error('[진행기]', safeMessage(err));
    }
    current = null;
  }
  busy = false;
}

async function fail(t, err) {
  const msg = safeMessage(err);
  if (err.limit) {
    await setTask(t.id, { status: '한도대기', paused_status: t.status, error: msg }, true);
    await post(t.id, '시스템', `${msg} 15분마다 자동으로 다시 시도합니다.`, '시스템');
  } else {
    await setTask(t.id, { status: '실패', paused_status: t.status, error: msg }, true);
    await post(t.id, '시스템', `진행 중 문제가 생겨 멈췄습니다: ${msg}\n업무 화면에서 "다시 진행"을 누르면 멈춘 곳부터 다시 시도합니다.`, '시스템');
  }
  await event(t.id, err.limit ? '한도대기' : '실패', '본부 시스템', msg);
}

async function runTask(id) {
  for (let guard = 0; guard < 300; guard++) {
    let t = await getTask(id);
    if (!t) return;
    if (!ACTIVE.includes(t.status)) {
      if (!['한도대기', '실패'].includes(t.status)) await replyOnly(id);
      return;
    }
    try {
      if ((await handleInterrupts(t)) === 'paused') return;
      t = await getTask(id);
      if (!ACTIVE.includes(t.status)) return;
      const step = STEPS[t.step];
      if (!step) throw new Error(`알 수 없는 단계: ${t.step}`);
      await step(t);
    } catch (err) {
      await fail(t, err);
      return;
    }
  }
}

async function replyOnly(id) {
  const t = await getTask(id);
  if (!t) return;
  if (ACTIVE.includes(t.status)) return runTask(id);
  try {
    await handleInterrupts(t);
  } catch (err) {
    await post(t.id, '시스템', `김비서가 답하지 못했습니다: ${safeMessage(err)}`, '시스템');
  }
}

// ───────── 화면에서 부르는 동작 ─────────
async function createTask(instruction) {
  const title = instruction.replace(/\s+/g, ' ').slice(0, 40);
  const r = await query('INSERT INTO tasks (title, instruction) VALUES ($1,$2) RETURNING id', [title, instruction]);
  bus.emit('task', { id: r.rows[0].id, status: '접수', title, step: 1 });
  schedule(r.rows[0].id);
  return r.rows[0].id;
}

async function approve(id) {
  const t = await getTask(id);
  if (!t || t.status !== '승인대기') throw new Error('승인 대기 중인 업무가 아닙니다.');
  const m = await latestMeeting(id);
  for (const d of m.assignment_plan.decisions || []) {
    await query('INSERT INTO decisions (task_id, content, rationale, decided_by) VALUES ($1,$2,$3,$4)',
      [id, d.content, d.rationale, 'CEO 승인(김비서 안)']);
  }
  await event(id, '승인', 'CEO');
  await post(id, '시스템', '대표님이 배정안을 승인했습니다. 담당자별로 업무를 시작합니다.', '시스템');
  await setTask(id, { status: '수행중', step: 7 });
  schedule(id);
}

async function reject(id, reason) {
  const t = await getTask(id);
  if (!t || t.status !== '승인대기') throw new Error('승인 대기 중인 업무가 아닙니다.');
  if (!reason || !reason.trim()) throw new Error('반려 사유를 적어 주세요.');
  await event(id, '반려', 'CEO', reason.trim());
  await post(id, '시스템', `대표님이 배정안을 반려했습니다. 사유: ${reason.trim()}`, '시스템');
  await setTask(id, { status: '회의중', step: 3, reject_count: t.reject_count + 1 });
  schedule(id);
}

async function pause(id) {
  const t = await getTask(id);
  if (!t || !PAUSABLE.includes(t.status)) throw new Error('지금은 멈출 수 있는 상태가 아닙니다.');
  await setTask(id, { status: '일시정지', paused_status: t.status });
  await event(id, '일시정지', 'CEO');
  await post(id, '시스템', '일시정지했습니다. 지금 진행 중인 발언 하나가 끝나면 멈춥니다.', '시스템');
}

async function resume(id) {
  const t = await getTask(id);
  if (!t || !['일시정지', '한도대기', '실패'].includes(t.status)) throw new Error('다시 진행할 수 있는 상태가 아닙니다.');
  await setTask(id, { status: t.paused_status || '접수', paused_status: null, error: null }, true);
  await event(id, '다시 진행', 'CEO');
  await post(id, '시스템', '다시 진행합니다.', '시스템');
  schedule(id);
}

async function ceoSay(taskId, body) {
  const t = taskId ? await getTask(taskId) : null;
  if (taskId && !t) throw new Error(`업무 #${taskId}을 찾을 수 없습니다.`);
  let meetingId = null;
  if (t && t.status === '회의중') meetingId = (await latestMeeting(taskId))?.id || null;
  const r = await query(
    `INSERT INTO messages (task_id, meeting_id, speaker, kind, body, handled) VALUES ($1,$2,'CEO','CEO',$3,false) RETURNING *`,
    [taskId || null, meetingId, body.trim()]
  );
  bus.emit('message', r.rows[0]);
  if (!taskId) schedule(null, 'reply');
  else if (current !== taskId) schedule(taskId, ACTIVE.includes(t.status) ? 'run' : 'reply');
  // 지금 이 업무가 진행 중이면 다음 발언 차례 전에 김비서가 먼저 받는다.
}

// 서버가 켜질 때: 하던 업무를 이어서, 한도대기는 15분마다 다시 시도.
async function start() {
  const r = await query(`SELECT id FROM tasks WHERE status = ANY($1) ORDER BY id`, [ACTIVE]);
  r.rows.forEach((x) => schedule(x.id));
  const p = await query(`SELECT DISTINCT task_id FROM messages WHERE kind='CEO' AND handled=false`);
  p.rows.forEach((x) => schedule(x.task_id, 'reply'));
  setInterval(async () => {
    try {
      const w = await query(`SELECT id FROM tasks WHERE status='한도대기'`);
      for (const x of w.rows) await resume(x.id);
    } catch (err) {
      console.error('[한도대기 재시도]', safeMessage(err));
    }
  }, 15 * 60 * 1000).unref();
}

function state() {
  return { busy, current, queued: queue.length };
}

module.exports = { createTask, approve, reject, pause, resume, ceoSay, start, state, schedule, ACTIVE, PAUSABLE };
