# 세타온 AI 가상 회사 (C:\atoum)

CEO가 비서실장(김비서)에게 지시하면 AI 직원들이 회의·분업·검수를 거쳐 보고하는 로컬 시스템. 전체 계획서는 `C:\Users\young\.claude\plans\pasted-content-id-69bc-dreamy-rossum.md`.

## 지켜야 할 것
- 서버는 127.0.0.1:4100에만 연다. 외부 공개·터널·포트 개방은 CEO 허용 없이는 하지 않는다.
- `.env`는 열지도, 출력하지도 않는다(DB 비밀번호). 오류 문장은 `src/db.js`의 `safeMessage`를 거친다.
- AI 연결은 구독 로그인만 쓴다. Claude는 Claude Code CLI(`claude -p`), 쫑전략(Gemini)은 Antigravity CLI(`%LOCALAPPDATA%\agy\bin\agy.exe -p`). API 키 방식은 쓰지 않는다. Gemini CLI는 2026-06-18 개인 계정 지원 종료로 쓸 수 없다.
- C:\ThetaRO 위키는 AI가 읽기만 한다. C:\ThetaON(급여·은행 자료)은 AI가 볼 수 없게 한다.
- C:\ThetaON-Office는 폐기된 이전 시도라 건드리지 않는다.
- 안내와 화면 문구는 비개발자 CEO 기준의 쉬운 한국어로 쓴다.

## 구성
- `src/server.js` — Express 서버, Host/Origin 검사
- `src/db.js` — PostgreSQL 18 접속(.env)
- `src/staff.js` — 직원 5명 명부와 페르소나
- `src/views.js`, `public/style.css` — 화면 틀
- `scripts/db-init.js` — DB(thetaon_company)·표 생성, 직원 명부 갱신(여러 번 실행해도 안전)

## 명령
- `npm run db:init` — 데이터베이스 준비
- `npm start` — 서버 켜기(끄기 Ctrl + C)
