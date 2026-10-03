// agy(쫑전략) 설정에 "신뢰 사이트 원문 열기" 허용·거부 목록을 맞춘다: node scripts/agy-permissions.js
// 설정 파일: %USERPROFILE%\.gemini\antigravity-cli\settings.json (고치기 전에 같은 폴더에 .bak 사본을 남긴다)
// 이 스크립트가 넣은 read_url(...) 규칙만 바꾸고, 다른 설정과 대표님이 직접 넣은 규칙은 그대로 둔다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DOMAINS, BLOCKED } = require('../src/sources');

const FILE = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
const MARK = '_thetaonReadUrl'; // 본부가 넣은 규칙 목록(다음에 바꿀 때 이전 것을 찾으려고)

const raw = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '{}';
const cfg = JSON.parse(raw || '{}');
fs.writeFileSync(`${FILE}.bak`, raw);

const prev = cfg[MARK] && !Array.isArray(cfg[MARK]) ? cfg[MARK] : { allow: cfg[MARK] || [], deny: [] };
const want = { allow: DOMAINS.map((d) => `read_url(${d})`), deny: BLOCKED.map((d) => `read_url(${d})`) };
cfg.permissions = cfg.permissions || {};
for (const k of ['allow', 'deny']) {
  const old = new Set(prev[k] || []);
  const kept = (cfg.permissions[k] || []).filter((r) => !old.has(r));
  cfg.permissions[k] = [...new Set([...kept, ...want[k]])];
}
cfg.permissions.ask = cfg.permissions.ask || [];
cfg[MARK] = want;

fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n');
console.log(`agy 원문 열기 목록을 맞췄습니다: 허용 ${want.allow.length}곳, 거부 ${want.deny.length}곳`);
console.log(`설정 파일: ${FILE} (이전 내용은 settings.json.bak)`);
