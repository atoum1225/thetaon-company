// 가짜 AI. AI_MOCK=1 일 때만 쓴다. 사용량을 쓰지 않고 업무 흐름 전체를 시험하기 위한 것.
// 서영업의 첫 산출물에는 일부러 금지 수치(64%)를 넣어 재작업 경로를 시험한다.

// MOCK_FAIL_ONCE=review 처럼 주면 그 단계 첫 호출만 "응답 없음"으로 실패시켜 자동 재시도를 시험한다.
const failedOnce = new Set();

// 쫑전략 외부 자료 조사 흉내: 검색하면 신뢰 사이트 자료 하나와 목록 밖 자료 하나를 돌려준다(목록 밖 표시 시험).
function mockSources(web) {
  if (web === 'off') return { sources: [], used: { searches: [], opened: [] } };
  const opened = web === 'read' ? ['https://www.kostat.go.kr/'] : [];
  return {
    sources: [
      { org: '국가데이터처', title: '시험 통계 자료', url: 'https://www.kostat.go.kr/', date: '2026-09', point: '시험용 외부 자료입니다.' },
      { org: '개인 블로그', title: '목록 밖 시험 자료', url: 'https://blog.example.com/post', date: '2026-08', point: '신뢰 목록 밖 자료 표시 시험입니다.' },
    ],
    used: { searches: ['시험 검색어 site:go.kr'], opened },
  };
}

async function respond({ emp, purpose, prompt, web = 'off' }) {
  await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY || 30)));
  if (process.env.MOCK_FAIL_ONCE === purpose && !failedOnce.has(purpose)) {
    failedOnce.add(purpose);
    const { AiError } = require('./ai');
    throw new AiError('가짜 AI: 응답 없음(시험)', { transient: true });
  }
  const usage = { input: 0, output: 0 };
  const j = (json) => ({ text: JSON.stringify(json), json, usage });
  const t = (text) => ({ text, json: null, usage });

  switch (purpose) {
    case 'define':
      return j({
        title: '시험 업무',
        goal: '시험용 목표',
        scope: '시험 범위',
        deadline: '미정',
        attendees: ['황기획', '서영업'],
        references: [],
        conflicts: [],
        // [CEO 지시]에 "원문 확인 시험"이 있으면(과거 기록 부분은 보지 않음) 김비서가 원문 확인을 요청하는 경로를 탄다.
        research_needed: /원문 확인 시험/.test(prompt.split('\n\n')[0]),
        research_reason: /원문 확인 시험/.test(prompt.split('\n\n')[0]) ? '시험: 공식 통계 원문 확인이 필요합니다.' : '',
        opening: '시험 업무 회의를 시작하겠습니다.\n- 범위와 마감 확인\n- 담당별 산출물 정하기',
      });
    case 'speak':
      return t(`${emp.name} 의견은 이렇습니다.\n- 시험 의견 하나\n- 할 수 있는 일: 시험 산출물 작성\n- 필요한 것: 시험 자료`);
    case 'advise_meeting': {
      const s = mockSources(web);
      return { ...j({ advice: '대외 수치는 조건을 붙여 쓰는 것을 권합니다.\n- 측정 조건 누락 위험 있음\n- 범위 표기 우회 점검 필요', sources: s.sources }), web: s.used };
    }
    case 'chair':
      return j({ continue: false, comment: '이 정도면 정리하겠습니다.' });
    case 'reply_ceo':
      return t('네 대표님, 말씀 반영하겠습니다.');
    case 'minutes':
      return j({
        minutes: '- 황기획: 기획안 구조 제안\n- 서영업: 제안 문안 방향 제시\n- 쫑전략: 수치 조건 점검 권고',
        decisions: [{ content: '시험 결정 1', rationale: '시험 근거' }],
        assignments: [
          { employee: '황기획', title: '기획안', description: '기획안 작성' },
          { employee: '서영업', title: '제안 문안', description: '제안 문안 작성' },
        ],
        review_criteria: '금지 수치가 없을 것, 근거가 붙어 있을 것',
      });
    case 'work': {
      const rework = /재작업/.test(prompt);
      if (emp.name === '서영업' && !rework) return t('# 제안 문안\n세타로는 GPU 전력을 64% 절감합니다.');
      return t(`## 요약\n- ${emp.name} 시험 산출물임\n\n## 내용\n| 항목 | 값 | 근거 |\n|---|---|---|\n| 토큰당 에너지 | −22.7% | J/tok, GPU 소켓 기준, H200×4·72B |`);
    }
    case 'review':
      return j({ result: '통과', note: '- 검수 기준 모두 충족\n- 수치에 측정 조건 붙어 있음' });
    case 'advise': {
      const s = mockSources(web);
      return { ...j({ advice: '조건부 수치의 측정 조건이 잘 붙어 있습니다. 대외 배포 전 한 번 더 확인을 권합니다.', risks: ['조건 누락 위험'], sources: s.sources }), web: s.used };
    }
    case 'adopt':
      return j({ adopted: '반영', reason: '타당한 조언이라 반영합니다.' });
    case 'final':
      return j({
        report: '## 요약\n- 시험 업무 완료\n- 산출물 2건 모두 통과\n\n## 결정사항\n- 시험 결정 1\n\n## 산출물 결과\n| 산출물 | 담당 | 검수 | 핵심 내용 |\n|---|---|---|---|\n| 기획안 | 황기획 | 통과 | 시험 기획안 |\n| 제안 문안 | 서영업 | 통과 | 금지 수치 제거 후 통과 |\n\n## 전략 조언 반영\n- 수치 조건 점검 → 반영, 타당함\n\n## 남은 과제·대표님 확인\n- 없음',
        staff_notes: [{ employee: '서영업', note: '64% 같은 금지 수치를 쓰지 않도록 주의.' }],
      });
    default:
      return t('시험 응답');
  }
}

module.exports = { respond };
