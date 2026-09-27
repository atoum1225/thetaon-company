// 세타온 본부 서버. 이 PC(127.0.0.1)에서만 열린다.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { safeMessage } = require('./db');
const { layout, esc } = require('./views');
const { router } = require('./pages');
const engine = require('./engine');
const bus = require('./bus');
const { startDailyBackup } = require('./backup');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4100);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const originOk = (origin) => !origin || ALLOWED_HOSTS.has(String(origin).replace(/^https?:\/\//, ''));

const app = express();
app.disable('x-powered-by');

// 다른 사이트나 다른 주소에서 들어온 요청은 받지 않는다.
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return res.status(403).send('허용되지 않은 주소입니다.');
  if (req.method !== 'GET' && !originOk(req.headers.origin)) {
    return res.status(403).send('다른 사이트에서 보낸 요청은 받지 않습니다.');
  }
  next();
});
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use(router);
app.use((err, req, res, next) => {
  console.error('[화면 오류]', safeMessage(err));
  res.status(500).send(layout('오류', `<h1>문제가 생겼습니다</h1><div class="card bad">${esc(safeMessage(err))}</div>`));
});

const server = http.createServer(app);

// 메신저 실시간 연결. 이 PC의 본부 화면에서 온 연결만 받는다.
const io = new Server(server, {
  allowRequest: (req, cb) => cb(null, ALLOWED_HOSTS.has(req.headers.host) && originOk(req.headers.origin)),
});
bus.on('message', (m) => io.emit('message', m));
bus.on('task', (t) => io.emit('task', t));

server.listen(PORT, HOST, async () => {
  console.log(`세타온 본부가 켜졌습니다: http://${HOST}:${PORT}  (끄려면 Ctrl + C)`);
  if (process.env.AI_MOCK === '1') console.log('[가짜 AI 시험 모드] 실제 AI를 부르지 않습니다.');
  try {
    await engine.start();
    startDailyBackup();
  } catch (err) {
    console.error('[진행기 시작 실패]', safeMessage(err));
  }
});

module.exports = { app, server };
