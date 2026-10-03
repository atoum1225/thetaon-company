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

async function ask(who, { taskId = null, purpose, prompt, schema = null, web = 'off' }) {
  const emp = await employee(who);
  const def = EMPLOYEES.find((e) => e.key === emp.key);
  // 대표님 말씀에 답하는 일은 업무당 호출 상한에서 뺀다.
  if (taskId && purpose !== 'reply_ceo') {
    const n = await query('SELECT count(*)::int AS n FROM ai_usage WHERE task_id=$1', [taskId]);
    if (n.rows[0].n >= MAX_CALLS_PER_TASK) {
      throw new AiError(`이 업무의 AI 호출이 ${MAX_CALLS_PER_TASK}회를 넘어 멈췄습니다. 사용량을 지키려는 안전장치입니다.`);
    }
  }
  // web: 쫑전략 외부 자료 조사 방식(off/search/read, ai.js 참고). 다른 직원은 무시한다.
  // 응답이 멈추거나 형식이 깨지는 일시적 문제는 한 번만 자동으로 다시 시도한다.
  for (let attempt = 1; ; attempt++) {
    try {
      return await askOnce(emp, def, { taskId, purpose, prompt, schema, web });
    } catch (err) {
      if (!err.transient || attempt >= 2) throw err;
      console.error(`[다시 시도] ${emp.name} ${purpose}: ${safeMessage(err)}`);
    }
  }
}

// 쫑전략(Gemini)이 구독 한도에 걸리면 같은 지시로 Claude가 대신한다(대표님 지시 2026-10-03, 업무 #6이 25시간 멈춘 일).
// 한도가 풀리는 시각까지는 Gemini를 다시 부르지 않고 바로 Claude로 간다(서버를 껐다 켜면 한 번 더 확인).
const FALLBACK_MODEL = 'sonnet';
let geminiBlockedUntil = 0;

async function askOnce(emp, def, opts) {
  if (emp.provider !== 'gemini') return callLogged(emp, def, opts, emp.provider);
  if (Date.now() < geminiBlockedUntil) return { ...(await callLogged(emp, def, opts, 'claude')), fallback: 'claude' };
  try {
    return await callLogged(emp, def, opts, 'gemini');
  } catch (err) {
    if (!err.limit) throw err;
    geminiBlockedUntil = err.retryAt || Date.now() + 60 * 60 * 1000;
    console.error(`[대체] ${emp.name} Gemini 한도 → ${new Date(geminiBlockedUntil).toLocaleString('ko-KR')}까지 Claude가 대신합니다.`);
    return { ...(await callLogged(emp, def, opts, 'claude')), fallback: 'claude' };
  }
}

// AI를 한 번 부르고 사용량 장부에 남긴다. provider가 직원 본래 것과 다르면 대체 호출이다.
async function callLogged(emp, def, { taskId, purpose, prompt, schema, web }, provider) {
  const substitute = provider !== emp.provider;
  const model = substitute ? FALLBACK_MODEL : emp.model;
  const label = substitute ? `${model}(${emp.name} 대체)` : model;
  const started = Date.now();
  bus.startWork({ taskId, who: emp.name, purpose, startedAt: started });
  try {
    let res;
    if (process.env.AI_MOCK === '1') {
      // MOCK_GEMINI_LIMIT=1이면 Gemini 호출을 한도 오류로 실패시켜 대체 경로를 시험한다.
      if (provider === 'gemini' && process.env.MOCK_GEMINI_LIMIT === '1') {
        throw new AiError('가짜 AI: 구독 사용량 한도(시험). in 0h1m0s', { limit: true, retryAt: Date.now() + 60 * 1000 });
      }
      res = await mock.respond({ emp, purpose, prompt, schema, web });
    } else {
      const system = personaPrompt(def);
      if (provider === 'gemini') res = await callGemini({ system, prompt, model, schema, web });
      else if (emp.provider === 'gemini') res = await callClaude({ system, prompt, model, schema, web: web || 'off' });
      else res = await callClaude({ system, prompt, model, schema });
    }
    if (schema && !res.json) throw new AiError(`${emp.name}의 답을 정해진 형식으로 읽지 못했습니다.`, { transient: true });
    await query(
      `INSERT INTO ai_usage (task_id, employee_id, provider, model, purpose, ok, duration_ms, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8)`,
      [taskId, emp.id, process.env.AI_MOCK === '1' ? 'mock' : provider, label, purpose, Date.now() - started, res.usage?.input || 0, res.usage?.output || 0]
    );
    return { ...res, emp };
  } catch (err) {
    await query(
      `INSERT INTO ai_usage (task_id, employee_id, provider, model, purpose, ok, duration_ms, error)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7)`,
      [taskId, emp.id, provider, label, purpose, Date.now() - started, safeMessage(err).slice(0, 500)]
    ).catch(() => {});
    throw err;
  } finally {
    bus.endWork();
  }
}

module.exports = { ask, employee };
