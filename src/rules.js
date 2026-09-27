// 금지 수치·조건부 수치 검사. 값뿐 아니라 지표 이름과 범위 표기 우회도 잡는다.
// 정본은 C:\ThetaRO 위키(CEO 확인 2026-09-27). DB company_facts에 넣어 두고 여기서 읽는다.
const { query } = require('./db');

const SRC = 'C:\\ThetaRO 위키 (thetaon-core-technologies, 2026-07-17 에너지 절감 결정, 2026-07-20 Intel 결정, 2026-09-03 IR 재등장 오류) · CEO 확인 2026-09-27';

// level: forbidden = 쓰면 안 됨(검수 자동 미달), conditional = 조건을 갖췄는지 사람이 확인
const DEFAULT_RULES = [
  ['forbidden', '64%', '64% 표기 금지. −63.4%의 반올림이라 비교 기준 오류를 그대로 물려받는다.', '(?<![\\d.])[-−–]?\\s?64\\s?%'],
  ['forbidden', '−63%', '−63% 표기 금지. 반올림해 낮춰 써도 문제는 비교 기준이다.', '[-−–]\\s?63\\s?%'],
  ['forbidden', '범위 25~63%', '범위 표기로 63%를 우회하는 것 금지(예: GPU 전력 절감 25~63%).', '\\d+(?:\\.\\d+)?\\s?%?\\s?[~∼〜]\\s?63(?:\\.4)?\\s?%'],
  ['forbidden', '서버 전력 절감', '서버 전력 절감 표현 금지. 측정은 GPU 소켓 기준이다.', '서버\\s?(?:전체\\s?)?전력\\s?(?:을\\s?|의\\s?)?[^\\n]{0,8}절감'],
  ['forbidden', '전기료 63%', '연간 서버 전기료 63% 절감류 표현 금지.', '전기\\s?(?:료|요금|세)[^\\n]{0,20}63'],
  ['forbidden', '512토큰 63.4%', '"동일 출력 512토큰 기준 −63.4%"는 사실과 다른 라벨. 512토큰 통제의 답은 −22.7%.', '512\\s?토큰[^\\n]{0,30}63'],
  ['forbidden', 'Intel 32% 3종', 'Intel 평균 전력 −32%·속도 +32%·토큰 −32% 금지(작업량 미보정).', '(?:전력|속도|토큰\\s?수?)[^\\n\\d]{0,10}[-−+]?\\s?32\\s?%'],
  ['forbidden', 'NPU 868×', 'NPU 868× 금지(비교 모델이 다름).', '868\\s?(?:×|x|배)'],
  ['forbidden', '다올 −82.6%', '다올TS 기준선 값(세타 미적용, 동시성만 변경) 인용 금지.', '82\\.6\\s?%'],
  ['forbidden', '다올 −64.5%', '다올TS 기준선 값 인용 금지. 폐기 수치 64%와 같은 숫자로 읽힌다.', '64\\.5\\s?%'],
  ['forbidden', '−44.9%', 'θ-Engine 헤드라인 −44.9% 인용 불가.', '44\\.9\\s?%'],
  ['forbidden', '−69%', 'θ-Engine 헤드라인 −69% 인용 불가.', '[-−–]\\s?69\\s?%'],
  ['forbidden', 'BERT 0.98', '다올TS PoC 보고서의 품질 BERT Score 0.98 행은 삭제하기로 한 것(2026-09-07). Intel AI PC의 BERTScore 0.972는 2026-07-20 확정 인용값이라 별개다.', '[Bb][Ee][Rr][Tt]\\s?(?:[Ss]core\\s?)?0\\.98'],
  ['forbidden', '고객사 H/W PoC 라벨', '(고객사 제공 H/W PoC 기준) 라벨 금지. 저장 도메인 PoC는 없다.', '고객사\\s?제공\\s?H/?W\\s?PoC'],
  ['forbidden', '30% TCO Down', '30% TCO Down(PoC기준) 금지. PoC 근거 미확인.', '30\\s?%\\s?TCO'],
  ['forbidden', '토큰 절감 22.7%', '토큰당 에너지(J/tok) −22.7%를 "토큰 절감"으로 부르면 안 된다.', '토큰\\s?(?:수\\s?)?절감[^\\n]{0,12}22\\.7'],
  ['conditional', '−63.4%', '−63.4%는 4조건을 모두 갖춘 경우만: 에너지(J) 표기, 운전점 조건(고정 batch=4 대비 batch=1 자동 선택 구간), 작업량 차이 공개(Baseline 약 2.1배), −22.7% 동시 병기. 단독 사용 금지.', '63\\.4\\s?%'],
  ['conditional', '−22.7%', '토큰당 에너지 −22.7%(J/tok)는 측정 조건을 병기한다(GPU 소켓 기준, H200×4·72B 등). 반복 횟수 같은 세부 조건은 문서마다 다를 수 있으니, 인용한 근거 문서에 적힌 조건을 그대로 쓴다.', '22\\.7\\s?%'],
  ['conditional', '26.8×', 'Intel "Ollama 대비 에너지 효율 26.8×, 속도 +1.87×"는 동일 모델·동일 기기, GPU INT8, Galaxy Book6 Pro 조건 병기.', '26\\.8\\s?(?:×|x|배)'],
  ['conditional', '저장 85%', '저장 85%↓·인덱싱 60%↓·재처리 80%↓는 (Target) 라벨과 정해진 각주를 붙이고, 실측 수치와 같은 페이지에 두지 않는다.', '(?:저장|STORAGE|스토리지)[^\\n]{0,15}85\\s?%|85\\s?%\\s?↓'],
  ['conditional', 'GPU 전력 수치', '전력(W)과 에너지(J)를 구분한다. 총 에너지를 "전력"으로 부르지 않는다.', 'GPU\\s?전력[^\\n]{0,10}[-−]?\\s?\\d+(?:\\.\\d+)?\\s?%'],
  ['conditional', 'PoC·실측 라벨', '(PoC 기준)·(실측)·(검증 완료) 라벨은 실제 근거가 있는지 확인. 저장 지표에는 쓰면 안 된다.', '\\(\\s?(?:PoC\\s?기준|실측|검증\\s?완료)\\s?\\)'],
];

const COMPANY_FACTS = [
  ['회사명', '(주)세타온, 영문 ThetaON CO.,LTD., 브랜드 표기 ThetaON. 2025년 12월 설립.'],
  ['대표', '각자대표 이영환·서광영. 대외 문서는 별도 지시가 없으면 이영환 단독 표기.'],
  ['주소', '경기 화성시 동탄영천로 150 현대실리콘앨리 A동 1103호'],
  ['경영진', '서광영(CEO/CMO), 이영환(CEO/COO), 송명준(CTO, 부사장), 김종배(CIO, 이사, 닉네임 쫑2), 황영기(CSO, 전무).'],
  ['제품 명칭', '세타로(ThetaRO)는 세타온 상품 전체의 대표 이름(2026-09-14 결정). 문서 AI는 "온프렘 기업문서 AI". GPU 최적화는 세타로의 한 세타값이라 별도 이름 없음.'],
  ['수치 규칙', '수치에는 분모와 측정 조건을 함께 적는다. 근거가 없으면 "미확인"이라고 쓴다. 대외 자료는 나가기 전에 금지 수치 검사를 통과해야 한다.'],
];

async function seed(db) {
  for (const [category, key, content, pattern] of DEFAULT_RULES) {
    await db.query(
      `INSERT INTO company_facts (category, key, content, pattern, source) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (category, key) DO UPDATE SET content=EXCLUDED.content, pattern=EXCLUDED.pattern, source=EXCLUDED.source`,
      [category, key, content, pattern, SRC]
    );
  }
  for (const [key, content] of COMPANY_FACTS) {
    await db.query(
      `INSERT INTO company_facts (category, key, content, source) VALUES ('company',$1,$2,$3)
       ON CONFLICT (category, key) DO UPDATE SET content=EXCLUDED.content`,
      [key, content, 'C:\\ThetaRO\\AI-Sessions\\wiki\\concepts\\thetaon-corporate-profile.md 외']
    );
  }
}

let cache = null;
let cacheAt = 0;
async function loadRules() {
  if (cache && Date.now() - cacheAt < 60_000) return cache;
  const r = await query(`SELECT category, key, content, pattern FROM company_facts
                         WHERE category IN ('forbidden','conditional') ORDER BY category DESC, id`);
  cache = r.rows.map((row) => ({ ...row, re: new RegExp(row.pattern, 'gu') }));
  cacheAt = Date.now();
  return cache;
}

function scanWith(rules, text) {
  const hits = [];
  for (const r of rules) {
    r.re.lastIndex = 0;
    const found = new Set();
    let m;
    while ((m = r.re.exec(text)) !== null) {
      found.add(m[0].trim());
      if (m.index === r.re.lastIndex) r.re.lastIndex++;
    }
    for (const match of found) hits.push({ level: r.category, key: r.key, content: r.content, match });
  }
  return hits;
}

// 글에서 걸리는 표현을 찾는다. [{level, key, content, match}]
// 정정 대조표처럼 틀린 원문을 보여줘야 할 때는 ~~취소선~~ 안에 넣는다. 그 안의 금지 표현은
// "원문 인용"(quoted)으로만 표시하고 검수 자동 미달에서 뺀다.
async function scan(text) {
  const rules = await loadRules();
  const quoted = [];
  const plain = String(text || '').replace(/~~([\s\S]*?)~~/g, (all, inner) => {
    quoted.push(inner);
    return ' '.repeat(all.length);
  });
  const hits = scanWith(rules, plain);
  for (const q of quoted) {
    for (const h of scanWith(rules, q)) if (h.level === 'forbidden') hits.push({ ...h, level: 'quoted' });
  }
  return hits;
}

async function rulesText() {
  const rules = await loadRules();
  const f = rules.filter((r) => r.category === 'forbidden').map((r) => `- ${r.key}: ${r.content}`);
  const c = rules.filter((r) => r.category === 'conditional').map((r) => `- ${r.key}: ${r.content}`);
  return `[쓰면 안 되는 수치·표현]\n${f.join('\n')}\n\n[조건을 갖춰야 쓸 수 있는 수치]\n${c.join('\n')}\n\n` +
    `[정정표에서 틀린 원문을 보여줘야 할 때]\n고쳐야 할 원문 문구는 ~~취소선~~으로 감싸서 인용한다(예: ~~GPU 전력 -64%~~). 취소선 안은 "원문 인용"으로 보고 금지 수치 검사에서 빼 준다. 취소선 없이 그대로 쓰면 검수에서 자동 미달이다. 대외로 나가는 문서에는 취소선 인용도 넣지 않는다.`;
}

async function companyText() {
  const r = await query(`SELECT key, content FROM company_facts WHERE category='company' ORDER BY id`);
  return r.rows.map((x) => `- ${x.key}: ${x.content}`).join('\n');
}

const LEVEL_NAMES = { forbidden: '금지', conditional: '조건 확인', quoted: '원문 인용(취소선)' };

function hitsText(hits) {
  if (!hits || !hits.length) return '걸린 표현 없음';
  return hits.map((h) => `- [${LEVEL_NAMES[h.level] || h.level}] "${h.match}" — ${h.content}`).join('\n');
}

module.exports = { seed, scan, rulesText, companyText, hitsText, loadRules, LEVEL_NAMES };
