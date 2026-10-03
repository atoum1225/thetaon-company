# 세타온 AI 가상 회사 (C:\atoum)

CEO가 비서실장(김비서)에게 지시하면 AI 직원들이 회의·분업·검수를 거쳐 보고하는 로컬 시스템. 전체 계획서는 `C:\Users\young\.claude\plans\pasted-content-id-69bc-dreamy-rossum.md`.

## 지켜야 할 것
- 서버는 127.0.0.1:4100에만 연다. 외부 공개·터널·포트 개방은 CEO 허용 없이는 하지 않는다.
- `.env`는 열지도, 출력하지도 않는다(DB 비밀번호). 오류 문장은 `src/db.js`의 `safeMessage`를 거친다.
- AI 연결은 구독 로그인만 쓴다. Claude는 Claude Code CLI(`claude -p`), 쫑전략(Gemini)은 Antigravity CLI(`%LOCALAPPDATA%\agy\bin\agy.exe`, stream-json 표준입력). API 키 방식은 쓰지 않는다. Gemini CLI는 2026-06-18 개인 계정 지원 종료로 쓸 수 없다.
- AI 직원은 `%TEMP%\thetaon-work`에서 실행되고 C:\ThetaRO 위키만 읽기 도구로 볼 수 있다. C:\ThetaON(급여·은행 자료)은 AI가 볼 수 없다.
- C:\ThetaON-Office는 폐기된 이전 시도라 건드리지 않는다.
- 세타로 소스코드 연결(송개발의 코드 작업)은 보류. 소스 위치가 정해지면 Phase를 추가한다.
- 안내와 화면 문구는 비개발자 CEO 기준의 쉬운 한국어로 쓴다.

## 구성
- `src/server.js` — Express + Socket.IO, Host/Origin 검사, 하루 1회 자동 백업
- `src/engine.js` — 10단계 업무 진행기(한 번에 AI 호출 하나, 단계 위치를 DB에 남겨 재시작해도 이어짐)
- `src/company.js` — 직원 호출 창구, 사용량 장부(ai_usage), 업무당 호출 상한
- `src/ai.js` — Claude·Antigravity CLI 호출기(CLI 사용법이 바뀌면 여기만 고친다)
- `src/staff.js` — 직원 5명 명부와 페르소나
- `src/rules.js` — 금지·조건부 수치 목록(정본: C:\ThetaRO 위키, CEO 확인 2026-09-27)과 검사기
- `src/memory.js` — 과거 기록 검색(pg_trgm/ILIKE)과 위키 index.md 후보 찾기
- `src/pages.js`, `src/views.js`, `public/` — 업무 사이트와 메신저 화면
- `src/wiki.js` — 위키 저장: 최종 보고서를 AI 없이 그대로 AI-Sessions/wiki/projects/thetaon-hq-task-N-report.md로 저장, index.md(Projects)·log.md 한 줄 추가(월별 로그 보관 포함). 기존 문서·raw는 건드리지 않는다. 시험은 WIKI_DIR로 위키 사본을 가리켜서 한다. 미리 보기: node scripts/wiki-preview.js N (scripts/wiki-stop-test.js는 폐기된 저장안 방식용이라 쓰지 않는다)
- `src/report.js` — 최종 보고서 HTML(/tasks/:id/report, ?download=1은 파일 받기)
- `src/backup.js` — pg_dump 백업(backups/, 최근 14개, git 제외)
- `src/mock.js` — 가짜 AI(AI_MOCK=1)

## 명령
- `npm run db:init` — 데이터베이스 준비(여러 번 실행해도 안전, 금지 수치 목록 갱신)
- `npm start` — 서버 켜기(끄기 Ctrl + C)
- `npm run backup` — 지금 백업. `node scripts/backup.js --test-restore`는 복원 시험까지
- `node scripts/rules-test.js` — 금지 수치 검사 시험
- `node scripts/trash-test.js` — 휴지통(삭제·되살리기) 시험(4101 가짜 서버, `$env:DB_NAME='thetaon_test'` 필요)
- `node scripts/inspect.js [업무번호]` — 업무 상태·대화 훑어보기

## 시험 방법
실제 DB와 섞이지 않게 시험용 DB와 가짜 AI로 돌린다:
`$env:DB_NAME='thetaon_test'; $env:PORT='4101'; $env:AI_MOCK='1'; npm run db:init; npm start`
가짜 AI에서는 서영업의 첫 산출물에 64%가 들어가 재작업 경로를 탄다.
