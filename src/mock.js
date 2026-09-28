// 가짜 AI. AI_MOCK=1 일 때만 쓴다. 사용량을 쓰지 않고 업무 흐름 전체를 시험하기 위한 것.
// 서영업의 첫 산출물에는 일부러 금지 수치(64%)를 넣어 재작업 경로를 시험한다.

// MOCK_FAIL_ONCE=review 처럼 주면 그 단계 첫 호출만 "응답 없음"으로 실패시켜 자동 재시도를 시험한다.
const failedOnce = new Set();

async function respond({ emp, purpose, prompt }) {
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
        opening: '시험 업무로 회의를 열겠습니다. 황기획, 서영업 의견 부탁합니다.',
      });
    case 'speak':
      return t(`${emp.name} 의견입니다. 시험 발언입니다.`);
    case 'advise_meeting':
      return t('참고 의견입니다. 대외 수치는 조건을 붙여 쓰는 것을 권합니다.');
    case 'chair':
      return j({ continue: false, comment: '이 정도면 정리하겠습니다.' });
    case 'reply_ceo':
      return t('네 대표님, 말씀 반영하겠습니다.');
    case 'minutes':
      return j({
        minutes: '시험 회의록입니다.',
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
      return t(`# ${emp.name} 산출물\n시험 산출물입니다. 토큰당 에너지 −22.7%(J/tok, GPU 소켓 기준, H200×4·72B).`);
    }
    case 'review':
      return j({ result: '통과', note: '기준 충족' });
    case 'advise':
      return j({ advice: '조건부 수치의 측정 조건이 잘 붙어 있습니다. 대외 배포 전 한 번 더 확인을 권합니다.', risks: ['조건 누락 위험'] });
    case 'adopt':
      return j({ adopted: '반영', reason: '타당한 조언이라 반영합니다.' });
    case 'final':
      return j({
        report: '# 최종 보고\n시험 업무를 마쳤습니다.',
        staff_notes: [{ employee: '서영업', note: '64% 같은 금지 수치를 쓰지 않도록 주의.' }],
      });
    case 'wiki_draft':
      return j({
        save: true,
        filter_reasons: ['3) 의사결정 근거와 결정권자 추적 필요'],
        not_save_reason: '',
        category: 'decision',
        slug: 'mock-wiki-save-test',
        title: '시험 위키 저장',
        summary: '위키 저장 기능 시험 문서',
        status: 'draft',
        body: '## Summary\n시험입니다.\n\n## Context\n시험.\n\n## Details\n시험.\n\n## Links\n- [[theta-definition]]',
        links: ['theta-definition', 'no-such-doc'],
      });
    default:
      return t('시험 응답');
  }
}

module.exports = { respond };
