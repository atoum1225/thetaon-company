# 인수인계 (2026-10-03)

다음 세션은 이 문서와 `CLAUDE.md`를 먼저 읽는다. 전체 계획서는 `C:\Users\young\.claude\plans\pasted-content-id-69bc-dreamy-rossum.md`.

## 지금 상태
- 계획서 Phase 0~8 완료. 시범 운영(업무 #1~#5) 뒤 개선까지 반영했고, CEO가 그룹웨어형 화면 개편에 만족을 표시함(2026-09-28).
- 코드: `C:\atoum` git, GitHub 비공개 저장소 `atoum1225/thetaon-company`(master). `git push`는 `.claude/settings.json` allow 규칙으로 허용됨. 커밋 끝에 Co-Authored-By 줄을 붙인다.
- 서버: CEO가 VS Code 터미널에서 `npm start`로 켠다(127.0.0.1:4100). 코드를 고친 뒤에는 CEO에게 Ctrl+C 후 `npm start`, 브라우저 F5를 안내한다.
- DB: PostgreSQL 18, 실제 `thetaon_company`, 시험 `thetaon_test`. 비밀번호는 `.env`(절대 읽지 않음).
- 업무 현황: #1 일시정지(지메일 확인, CEO가 멈춤), #2~#5 완료. #4는 위키 결정 문서로 저장됨(`AI-Sessions/wiki/decisions/2026-09-28-kt-catalog-v04-forbidden-number-check.md`, 옛 "저장안" 방식으로 저장된 것).

## CEO가 정한 것
- 구독 로그인만 사용(Claude Pro, Google AI Pro). API 키 과금 금지. 외부 접속 4곳(Anthropic, Google, npm, GitHub 비공개) 허용.
- 쫑전략은 Antigravity CLI(agy)로 동작. Gemini CLI는 개인 계정 지원 종료(2026-06-18)로 사용 불가.
- 쫑전략은 김종배 이사(CIO, 쫑2) 관점을 참고한 AI 조언자. 조언만 하고 결정하지 않음. 화면에 "AI 조언"으로 표시.
- C:\ThetaRO 위키는 AI가 읽기만 함. 위키 저장은 CEO가 버튼을 눌렀을 때 최종 보고서를 그대로(AI 재작성 없이) `projects/thetaon-hq-task-N-report.md`로 저장.
- 메신저는 사이트에 통합. 세타로 소스코드 연결은 "시기상조, 검토 안 함"(2026-09-28) — 다시 꺼내지 않는다.
- C:\ThetaON-Office(옛 API 키 방식)는 폐기, 건드리지 않음.

## CEO에게 안내하는 방식
- 비개발자, VS Code 터미널만 사용. 명령마다 ① 여는 위치 ② 실행 폴더 ③ 입력값(bash 블록) ④ 이유 ⑤ 성공 화면 ⑥ 실패 대처를 쓴다.
- 이 PC의 `code` 명령은 Cursor를 연다. 파일 열기는 VS Code 탐색기로 안내한다.
- 위키 말투 규칙(이모지·과한 강조 없이 자연스러운 한국어)을 직원 페르소나와 보고서에도 적용 중.

## 시범 운영에서 배운 것 (다시 겪지 않게)
- 해제된 "멈춰"를 직원이 유효한 지시로 읽어 빈 산출물을 냄 → `ceoTalk`에서 "해제된 멈춤"으로 표시.
- 정정표에 틀린 원문을 그대로 적으면 금지 수치 검사에 걸림 → `~~취소선~~` 안은 "원문 인용"으로 인정.
- "멈춰"/"다시 진행"은 채팅으로도 즉시 처리(진행 중 AI 호출 결과는 저장만 하고 멈춤).
- Claude 세션 한도 문구 "You've hit your session limit · resets …"를 한도대기로 처리, 15분마다 자동 재시도.
- AI 호출 6분 넘게 응답 없으면 끊고 한 번 자동 재시도.
- Claude Pro로는 5시간에 업무 2~3건이 현실적(검수·산출물 호출이 1~2분씩).
- 확인 스크립트가 잘못 끝나 "멈췄다"고 오판한 적 있음 → 상태를 볼 때는 `node scripts/inspect.js N --timeline`의 시각을 꼭 확인.
- 이 폴더에서는 파일 삭제(Remove-Item, git rm)가 하네스에 막힌다.

## 남은 일·후보
- 위키에서 확인 필요(업무 #2~#4 보고서에서 나옴): −22.7% 측정 조건이 문서마다 다름(6회 반복 vs 3회·512토큰 통제), KT 카탈로그 3쪽 "KT 마진 미포함" 문구 누락, 대외비 각주 관련 결정 #9 정리.
- CEO가 요청하면: 화면 세부 조정, 지메일 등 외부 연동(목적·범위·위험을 제시하고 허용받은 뒤), 직원 모델 조정.

## 자주 쓰는 확인
- `node scripts/inspect.js` (전체) / `node scripts/inspect.js N --timeline` / `--report` / `--calls`
- 시험: `$env:DB_NAME='thetaon_test'; $env:PORT='4101'; $env:AI_MOCK='1'` (+ `MOCK_DELAY`, `MOCK_FAIL_ONCE`, 위키는 `WIKI_DIR`에 사본)
- `node scripts/rules-test.js`, `node scripts/pause-test.js`(4101 가짜 서버 필요), `node scripts/wiki-preview.js N`
