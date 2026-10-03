// 쫑전략이 외부 자료를 찾을 때 믿고 쓰는 사이트 목록(대표님 지시 2026-10-03).
// 도메인을 적으면 그 아래 주소도 포함된다(go.kr → www.mois.go.kr). 주소 경로는 따지지 않는다.
// 목록을 바꾸면 `node scripts/agy-permissions.js`로 agy 설정(원문 열기 허용 목록)도 맞춘다.

const TRUSTED = [
  { group: '정부·공공기관', domains: ['go.kr', 'or.kr', 'korea.kr', 'kepco.co.kr', 'krx.co.kr', 'gov', 'europa.eu', 'gov.uk', 'go.jp'] },
  { group: '국제기구', domains: ['oecd.org', 'iea.org', 'un.org', 'worldbank.org', 'imf.org', 'who.int', 'wto.org', 'itu.int'] },
  { group: '연구기관·학계', domains: ['re.kr', 'ac.kr', 'edu', 'arxiv.org', 'nature.com', 'science.org', 'ieee.org', 'acm.org'] },
  { group: '언론사', domains: [
    'yna.co.kr', 'kbs.co.kr', 'imbc.com', 'sbs.co.kr', 'ytn.co.kr', 'chosun.com', 'joongang.co.kr', 'donga.com', 'hani.co.kr', 'khan.co.kr',
    'mk.co.kr', 'hankyung.com', 'sedaily.com', 'etnews.com', 'zdnet.co.kr', 'ddaily.co.kr', 'newsis.com', 'news1.kr',
    'reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'nytimes.com', 'bbc.com', 'bbc.co.uk', 'apnews.com', 'nikkei.com',
  ] },
  { group: '대기업', domains: [
    'samsung.com', 'skhynix.com', 'sk.com', 'sktelecom.com', 'lg.com', 'lgcns.com', 'kt.com', 'hyundai.com', 'navercorp.com', 'kakaocorp.com',
    'nvidia.com', 'intel.com', 'amd.com', 'microsoft.com', 'ibm.com', 'aws.amazon.com', 'openai.com', 'anthropic.com',
  ] },
  { group: '기타 신뢰 자료', domains: ['gartner.com', 'idc.com', 'mckinsey.com'] },
];

const DOMAINS = TRUSTED.flatMap((g) => g.domains);

// 원문 열기를 항상 막는 주소. Google 검색 결과의 중계 주소는 아무 사이트로나 넘어갈 수 있어
// 목록을 우회하는 길이 된다(2026-10-03 실제 호출에서 확인). agy는 거부를 허용보다 먼저 본다.
const BLOCKED = ['vertexaisearch.cloud.google.com'];

// https:// 없이 온 주소(예: motie.go.kr)에 붙여 준다.
function normalizeUrl(url) {
  const u = String(url || '').trim();
  return !u || /^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/+/, '')}`;
}

function hostOf(url) {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { return ''; }
}

// 주소가 신뢰 목록 안인지. 도메인 그 자체이거나 그 아래 주소면 맞다.
function isTrusted(url) {
  const h = hostOf(url);
  const under = (d) => h === d || h.endsWith(`.${d}`);
  return !!h && !BLOCKED.some(under) && DOMAINS.some(under);
}

function listText() {
  return TRUSTED.map((g) => `- ${g.group}: ${g.domains.join(', ')}`).join('\n');
}

module.exports = { TRUSTED, DOMAINS, BLOCKED, isTrusted, hostOf, normalizeUrl, listText };
