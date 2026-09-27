// AI 호출기. 구독 로그인된 CLI를 한 번씩 실행해서 답을 받는다(API 키 과금 없음).
// Claude = Claude Code CLI, Gemini(쫑전략) = Antigravity CLI.
// CLI 사용법이 바뀌면 이 파일만 고치면 된다.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WIKI_DIR = 'C:\\ThetaRO';
const CLAUDE_BIN = process.env.CLAUDE_BIN || path.join(os.homedir(), '.local', 'bin', 'claude.exe');
const AGY_BIN = process.env.AGY_BIN || path.join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe');
// AI가 일하는 빈 폴더. C:\atoum 밖에 둬서 .env나 본부 코드가 AI 눈에 들어가지 않게 한다.
const WORK_DIR = path.join(os.tmpdir(), 'thetaon-work');
const TIMEOUT_MS = 10 * 60 * 1000;

class AiError extends Error {
  constructor(message, { limit = false, retryAt = null } = {}) {
    super(message);
    this.limit = limit;     // 구독 사용량 한도에 걸렸는지
    this.retryAt = retryAt; // 알 수 있으면 다시 시도할 시각
  }
}

function run(bin, args, input, cwd) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(cwd, { recursive: true });
    const env = { ...process.env };
    // 혹시 API 키가 환경에 있어도 쓰지 않는다(구독 로그인만 사용).
    delete env.ANTHROPIC_API_KEY;
    delete env.GEMINI_API_KEY;
    delete env.DB_PASSWORD;
    const child = spawn(bin, args, { cwd, env, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new AiError('AI 응답 시간이 10분을 넘어 중단했습니다.'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new AiError(`AI 프로그램을 실행할 수 없습니다: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    child.stdin.end(input, 'utf8');
  });
}

const LIMIT_RE = /usage limit|rate limit|limit reached|quota|resource_exhausted|429|too many requests|사용량 한도/i;

function limitError(text) {
  const m = String(text).match(/resets? (?:at )?([^\n.]+)/i);
  return new AiError(`구독 사용량 한도에 걸렸습니다. ${m ? '재개 예정: ' + m[1] : ''}`.trim(), { limit: true });
}

// JSON 답을 기대할 때, 글 속에 섞인 JSON 덩어리를 꺼낸다.
function extractJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text || '').trim();
  try { return JSON.parse(s); } catch {}
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

async function callClaude({ system, prompt, model = 'sonnet', schema, readWiki = true }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', model,
    '--system-prompt', system,
    '--tools', readWiki ? 'Read,Grep,Glob' : '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
  ];
  if (readWiki) args.push('--add-dir', WIKI_DIR);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  const { code, out, err } = await run(CLAUDE_BIN, args, prompt, WORK_DIR);
  let data;
  try { data = JSON.parse(out); } catch {
    const text = (err || out).trim();
    if (LIMIT_RE.test(text)) throw limitError(text);
    throw new AiError(`Claude 응답을 읽지 못했습니다(종료 코드 ${code}): ${text.slice(0, 300)}`);
  }
  if (data.is_error) {
    const text = String(data.result || data.subtype || '');
    if (LIMIT_RE.test(text)) throw limitError(text);
    throw new AiError(`Claude 오류: ${text.slice(0, 300)}`);
  }
  const u = data.usage || {};
  return {
    text: String(data.result || ''),
    json: schema ? (data.structured_output || extractJson(data.result)) : null,
    usage: {
      input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
      output: u.output_tokens || 0,
    },
  };
}

async function callGemini({ system, prompt, model = 'gemini-3.1-pro-high', schema }) {
  // Antigravity CLI에는 system prompt 옵션이 없어 역할 설명을 질문 앞에 붙인다.
  // 도구를 쓰려다 거부되면 빈 답이 나오므로, 주어진 글만으로 바로 답하라고 못박는다.
  const full = `[역할]\n${system}\n\n[작업 방식]\n파일 열기, 명령 실행, 검색 같은 도구는 쓰지 않는다. 아래 [요청]에 적힌 정보만으로 바로 답한다.` +
    (schema ? `\n답은 다음 JSON 형식 하나만 출력한다(설명 문장 없이):\n${JSON.stringify(schema)}` : '') +
    `\n\n[요청]\n${prompt}`;
  // 긴 글은 명령줄 길이 제한에 걸리므로 stream-json으로 표준입력에 넣는다. plan 모드 = 읽기만.
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json',
    '--model', model, '--mode', 'plan', '--print-timeout', '600s', '-p='];
  const input = JSON.stringify({ event: 'user', message: { content: full } }) + '\n';
  const { code, out, err } = await run(AGY_BIN, args, input, WORK_DIR);
  let data;
  try {
    const last = out.trim().split('\n').reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((o) => o && o.event === 'result');
    data = last.result;
  } catch {
    const text = (err || out).trim();
    if (LIMIT_RE.test(text)) throw limitError(text);
    throw new AiError(`Gemini 응답을 읽지 못했습니다(종료 코드 ${code}): ${text.slice(0, 300)}`);
  }
  if (data.status && data.status !== 'SUCCESS') {
    const text = JSON.stringify(data).slice(0, 300);
    if (LIMIT_RE.test(text)) throw limitError(text);
    throw new AiError(`Gemini 오류: ${text}`);
  }
  const u = data.usage || {};
  const text = String(data.response || '');
  return {
    text,
    json: schema ? (data.structured_output || extractJson(text)) : null,
    usage: { input: u.input_tokens || 0, output: (u.output_tokens || 0) + (u.thinking_tokens || 0) },
  };
}

module.exports = { callClaude, callGemini, extractJson, AiError, WIKI_DIR };
