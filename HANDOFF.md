# 인수인계 (2026-10-03)

다음 세션은 이 문서와 `CLAUDE.md`를 먼저 읽는다. 전체 계획서는 `C:\Users\young\.claude\plans\pasted-content-id-69bc-dreamy-rossum.md`.

## 지금 상태
- 계획서 Phase 0~8 완료. 시범 운영(업무 #1~#5) 뒤 개선까지 반영했고, CEO가 그룹웨어형 화면 개편에 만족을 표시함(2026-09-28).
- 코드: `C:\atoum` git, GitHub 비공개 저장소 `atoum1225/thetaon-company`(master). `git push`는 `.claude/settings.json` allow 규칙으로 허용됨. 커밋 끝에 Co-Authored-By 줄을 붙인다.
- 서버: CEO가 VS Code 터미널에서 `npm start`로 켠다(127.0.0.1:4100). 코드를 고친 뒤에는 CEO에게 Ctrl+C 후 `npm start`, 브라우저 F5를 안내한다.
- DB: PostgreSQL 18, 실제 `thetaon_company`, 시험 `thetaon_test`. 비밀번호는 `.env`(절대 읽지 않음).
- 업무 현황: #1 일시정지(지메일 확인, CEO가 멈춤), #2~#5 완료. #4는 위키 결정 문서로 저장됨(`AI-Sessions/wiki/decisions/2026-09-28-kt-catalog-v04-forbidden-number-check.md`, 옛 "저장안" 방식으로 저장된 것).

## 시스템 설계 요약 (이어서 설계할 때 기준)

### 구조
```
대표님(브라우저 127.0.0.1:4100) ─ 업무 사이트 + 메신저(Socket.IO 실시간)
        │
   본부 서버(Node.js/Express, src/server.js)
        │
   업무 진행기(src/engine.js) ── 대기열에서 한 번에 AI 호출 하나
        ├─ Claude Code CLI `claude -p` (김비서·황기획·송개발·서영업, 모델 sonnet, 위키 읽기 도구만)
        ├─ Antigravity CLI `agy` (쫑전략, gemini-3.1-pro-high, plan 모드, 신뢰 사이트 웹 검색·원문 열기만)
        ├─ PostgreSQL 18 (공유 기억)
        └─ C:\ThetaRO 위키 (읽기 전용 참고, 최종 보고서 저장만 CEO 버튼으로)
```

### 업무 흐름 (tasks.step 1~11)
① 접수 → ② 김비서 과제 정의(과거 기록·위키 후보 자동 검색, 참석자 선정) → ③ 회의 소집 → ④ 토론(최대 3라운드, 한 번에 발언 하나: 참석자 → 쫑전략 → 김비서 진행 판단) → ⑤ 회의록·결정·배정안·검수 기준 → ⑥ **CEO 승인 대기**(반려 시 사유 들고 ③으로) → ⑦ 담당자 산출물 → ⑧ 김비서 검수(금지 수치 자동 미달, 재작업 최대 2회, 넘으면 일시정지) → ⑨ 쫑전략 조언 → 김비서 반영 판단 → ⑩ 최종 보고서(직원 작업 메모 저장) → 완료.
상태값: 접수/회의중/승인대기/수행중/검수중/전략조언/완료 + 일시정지/한도대기/실패 + 삭제됨(휴지통). 멈춤·재개는 paused_status에 원래 상태를 둔다.
휴지통(2026-10-03): 일시정지·한도대기·실패 업무에 "삭제" 버튼 → 상태 `삭제됨`, deleted_at 기록. 목록·검색·메신저·과거 기록(memory.searchRecords)에서 빠지고 DB에는 남는다. 되살리면 일시정지로 돌아오고 paused_status가 남아 "다시 진행"으로 이어진다. 진행 중이던 AI 호출이 끝나도 setTask가 삭제됨 업무를 덮어쓰지 않는다.

### DB 표 (scripts/db-init.js)
employees(직원·모델), tasks(지시·상태·단계·정의 JSON·최종 보고서·위키 저장 경로), task_events(진행 기록), meetings(차수·참석·라운드·turn·회의록·배정안 JSON·검수 기준), messages(메신저, CEO 말은 handled로 처리 여부), decisions(CEO 승인된 결정), advice(쫑전략 조언·반영 여부), deliverables(배정 번호별 판·검수 결과·금지 수치 검사 결과), staff_notes, company_facts(회사 정보·금지/조건부 수치 규칙 정규식), ai_usage(호출 장부), system_log.

### 화면 (src/pages.js, src/views.js, public/)
대시보드(현황 타일·업무 지시·결재함·진행 중·완료 보고·직원 현황·일반 대화), 업무함(필터 탭·진행 막대), 업무 상세(단계 표시·승인/반려·회의록·산출물·조언·최종 보고서 HTML·위키 저장·메신저), 전체 메신저, 과거 업무 검색, 직원·규칙(모델 변경·금지 수치표), AI 사용량. 화면의 data-live 영역은 실시간 부분 갱신.

## CEO가 정한 것
- 구독 로그인만 사용(Claude Pro, Google AI Pro). API 키 과금 금지. 외부 접속 4곳(Anthropic, Google, npm, GitHub 비공개) 허용. 추가로 쫑전략 원문 열기 때만 신뢰 사이트 목록(2026-10-03).
- 쫑전략은 Antigravity CLI(agy)로 동작. Gemini CLI는 개인 계정 지원 종료(2026-06-18)로 사용 불가.
- 쫑전략은 김종배 이사(CIO, 쫑2) 관점을 참고한 AI 조언자. 조언만 하고 결정하지 않음. 화면에 "AI 조언"으로 표시.
- 쫑전략 외부 자료 조사(2026-10-03): 정부·공공기관, 연구기관, 언론사, 대기업 등 신뢰 사이트(`src/sources.js`)만. 회의마다 1라운드 첫 발언과 ⑨ 산출물 조언 때 검색(2라운드부터는 찾은 자료 인용). 원문 열기는 대표님이 지시(업무 지시 체크박스·업무 화면 켜기/끄기)하거나 김비서가 ② 과제 정의에서 요청한 업무만. 대표님이 켜거나 끈 업무는 김비서가 바꾸지 않음. 찾은 자료는 external_sources 표, 업무 화면 "외부 자료" 카드, 최종 보고서 "외부 참고 자료" 절에 [원문 확인함/원문 확인 전]으로 남김.
- C:\ThetaRO 위키는 AI가 읽기만 함. 위키 저장은 CEO가 버튼을 눌렀을 때 최종 보고서를 그대로(AI 재작성 없이) `projects/thetaon-hq-task-N-report.md`로 저장.
- 메신저는 사이트에 통합. 세타로 소스코드 연결은 "시기상조, 검토 안 함"(2026-09-28) — 다시 꺼내지 않는다.
- C:\ThetaON-Office(옛 API 키 방식)는 폐기, 건드리지 않음.

## CEO에게 안내하는 방식
- 비개발자, VS Code 터미널만 사용. 명령마다 ① 여는 위치 ② 실행 폴더 ③ 입력값(bash 블록) ④ 이유 ⑤ 성공 화면 ⑥ 실패 대처를 쓴다.
- 이 PC의 `code` 명령은 Cursor를 연다. 파일 열기는 VS Code 탐색기로 안내한다.
- 위키 말투 규칙(이모지·과한 강조 없이 자연스러운 한국어)을 직원 페르소나와 보고서에도 적용 중.
- 개조식(2026-10-03 대표님 지시): 보고서·산출물·회의록·발언·메신저 모두 "요지 한 줄 + '- ' 항목 3~5개, 표 활용". 규칙은 staff.js COMMON, 단계별 분량은 engine.js 프롬프트. 최종 보고서 틀: 요약/결정사항/산출물 결과(표)/전략 조언 반영/외부 참고 자료/남은 과제·대표님 확인(wiki.js가 이 절 제목으로 요약·draft 판단). 화면은 AI 글을 마크다운으로 그린다(report.render, 메시지는 서버가 html로 바꿔 보냄).
- 세션이 길어지면 CEO가 "지금까지 내용을 HANDOFF.md에 반영해 줘"라고 한다. 그때 이 문서를 최신으로 고치고 커밋·푸시한 뒤, 새 세션(작업 폴더 C:\atoum)에서 이 문서부터 읽게 한다(2026-10-03 CEO 요청, 토큰 절약 목적).
- C:\atoum에 CEO 개인 파일(지시문 .txt 등)이 있을 수 있다. 열어 보지 않고, 커밋할 때는 파일을 하나씩 지정해서 올린다(git add -A 금지).

## 시범 운영에서 배운 것 (다시 겪지 않게)
- 해제된 "멈춰"를 직원이 유효한 지시로 읽어 빈 산출물을 냄 → `ceoTalk`에서 "해제된 멈춤"으로 표시.
- 정정표에 틀린 원문을 그대로 적으면 금지 수치 검사에 걸림 → `~~취소선~~` 안은 "원문 인용"으로 인정.
- "멈춰"/"다시 진행"은 채팅으로도 즉시 처리(진행 중 AI 호출 결과는 저장만 하고 멈춤).
- Claude 세션 한도 문구 "You've hit your session limit · resets …"를 한도대기로 처리, 15분마다 자동 재시도.
- AI 호출 6분 넘게 응답 없으면 끊고 한 번 자동 재시도.
- Claude Pro로는 5시간에 업무 2~3건이 현실적(검수·산출물 호출이 1~2분씩).
- 확인 스크립트가 잘못 끝나 "멈췄다"고 오판한 적 있음 → 상태를 볼 때는 `node scripts/inspect.js N --timeline`의 시각을 꼭 확인.
- 이 폴더에서는 파일 삭제(Remove-Item, git rm)가 하네스에 막힌다.
- agy 비대화(-p) 모드: search_web은 허락 없이 됨. read_url_content·run_command는 settings.json permissions.allow에 없으면 자동 거부되고, 하나라도 거부되면 답 전체가 빈 칸 → ai.js가 경고를 붙여 한 번 다시 묻는다. 권한은 전체 설정 파일 하나뿐(프로젝트별 설정 없음).
- agy는 검색 결과의 Google 중계 주소(vertexaisearch.cloud.google.com)를 원문으로 열려 한다. 아무 사이트로나 넘어갈 수 있어 deny로 막았다(cloud.google.com은 허용 목록에서 뺌). ai.js는 열린 주소가 목록 밖이면 답을 버린다.
- 원문 열기 호출은 2~4분 걸림(시험 133·251초) → 원문 모드만 시간 제한 10분.

## 남은 일·후보
- 위키에서 확인 필요(업무 #2~#4 보고서에서 나옴): −22.7% 측정 조건이 문서마다 다름(6회 반복 vs 3회·512토큰 통제), KT 카탈로그 3쪽 "KT 마진 미포함" 문구 누락, 대외비 각주 관련 결정 #9 정리.
- CEO가 요청하면: 화면 세부 조정, 지메일 등 외부 연동(목적·범위·위험을 제시하고 허용받은 뒤), 직원 모델 조정.

## 자주 쓰는 확인
- `node scripts/inspect.js` (전체) / `node scripts/inspect.js N --timeline` / `--report` / `--calls`
- 시험: `$env:DB_NAME='thetaon_test'; $env:PORT='4101'; $env:AI_MOCK='1'` (+ `MOCK_DELAY`, `MOCK_FAIL_ONCE`, 위키는 `WIKI_DIR`에 사본)
- `node scripts/rules-test.js`, `node scripts/pause-test.js`(4101 가짜 서버 필요), `node scripts/wiki-preview.js N`
