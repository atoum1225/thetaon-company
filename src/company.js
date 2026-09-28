// 직원에게 일을 시키는 창구. 누가 무엇 때문에 AI를 불렀는지 사용량 장부에 남긴다.
const { query, safeMessage } = require('./db');
const { callClaude, callGemini, AiError } = require('./ai');
const { EMPLOYEES, personaPrompt } = require('./staff');
const mock = require('./mock');
const bus = require('./bus');

const MAX_CALLS_PER_TASK = Number(process.env.MAX_CALLS_PER_TASK || 70);

async function employee(nameOrKey) {
  const r = await query('SELECT * FROM employees WHERE key=$1 OR name=$1', [nameOrKey]);
  if (!r.rows[0]) throw new AiError(`직원을 찾을 수 없습니다: ${nameOrKey}`);
  return r.rows[0];
}

async function ask(who, { taskId = null, purpose, prompt, schema = null }) {
  const emp = await employee(who);
  const def = EMPLOYEES.find((e) => e.key === emp.key);
  if (taskId) {
    const n = await query('SELECT count(*)::int AS n FROM ai_usage WHERE task_id=$1', [taskId]);
    if (n.rows[0].n >= MAX_CALLS_PER_TASK) {
      throw new AiError(`이 업무의 AI 호출이 ${MAX_CALLS_PER_TASK}회를 넘어 멈췄습니다. 사용량을 지키려는 안전장치입니다.`);
    }
  }
  // 응답이 멈추거나 형식이 깨지는 일시적 문제는 한 번만 자동으로 다시 시도한다.
  for (let attempt = 1; ; attempt++) {
    try {
      return await askOnce(emp, def, { taskId, purpose, prompt, schema });
    } catch (err) {
      if (!err.transient || attempt >= 2) throw err;
      console.error(`[다시 시도] ${emp.name} ${purpose}: ${safeMessage(err)}`);
    }
  }
}

async function askOnce(emp, def, { taskId, purpose, prompt, schema }) {
  const started = Date.now();
  bus.startWork({ taskId, who: emp.name, purpose, startedAt: started });
  try {
    let res;
    if (process.env.AI_MOCK === '1') {
      res = await mock.respond({ emp, purpose, prompt, schema });
    } else {
      const system = personaPrompt(def);
      res = emp.provider === 'gemini'
        ? await callGemini({ system, prompt, model: emp.model, schema })
        : await callClaude({ system, prompt, model: emp.model, schema });
    }
    if (schema && !res.json) throw new AiError(`${emp.name}의 답을 정해진 형식으로 읽지 못했습니다.`, { transient: true });
    await query(
      `INSERT INTO ai_usage (task_id, employee_id, provider, model, purpose, ok, duration_ms, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8)`,
      [taskId, emp.id, process.env.AI_MOCK === '1' ? 'mock' : emp.provider, emp.model, purpose, Date.now() - started, res.usage?.input || 0, res.usage?.output || 0]
    );
    return { ...res, emp };
  } catch (err) {
    await query(
      `INSERT INTO ai_usage (task_id, employee_id, provider, model, purpose, ok, duration_ms, error)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)`,
      [taskId, emp.id, emp.provider, emp.model, purpose, Date.now() - started, safeMessage(err).slice(0, 500)]
    ).catch(() => {});
    throw err;
  } finally {
    bus.endWork();
  }
}

module.exports = { ask, employee };
