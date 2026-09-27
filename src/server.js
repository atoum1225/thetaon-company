// 세타온 본부 서버. 이 PC(127.0.0.1)에서만 열린다.
const path = require('path');
const http = require('http');
const express = require('express');
const { query, safeMessage } = require('./db');
const { layout, esc } = require('./views');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4100);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const app = express();
app.disable('x-powered-by');

// 다른 사이트나 다른 주소에서 들어온 요청은 받지 않는다.
app.use((req, res, next) => {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return res.status(403).send('허용되지 않은 주소입니다.');
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) {
      return res.status(403).send('다른 사이트에서 보낸 요청은 받지 않습니다.');
    }
  }
  next();
});
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

app.get('/', async (req, res) => {
  let dbLine;
  let staffRows = '';
  try {
    const r = await query('SELECT version() AS v');
    dbLine = `<span class="ok">DB 연결됨</span> <span class="muted">${esc(r.rows[0].v.split(',')[0])}</span>`;
    const staff = await query('SELECT name, title, provider, model, duty FROM employees ORDER BY id');
    staffRows = staff.rows
      .map((e) => `<tr><td>${esc(e.name)}</td><td>${esc(e.title)}</td><td>${e.provider === 'claude' ? 'Claude' : 'Gemini'} <span class="muted">${esc(e.model)}</span></td><td>${esc(e.duty)}</td></tr>`)
      .join('');
  } catch (err) {
    dbLine = `<span class="bad">DB 연결 안 됨</span> ${esc(safeMessage(err))}`;
  }
  res.send(layout('본부', `
    <h1>세타온 본부</h1>
    <div class="card">${dbLine}</div>
    <h2>조직</h2>
    <table><tr><th>이름</th><th>직책</th><th>모델</th><th>담당</th></tr>${staffRows || '<tr><td colspan="4" class="muted">직원 명부가 비어 있습니다.</td></tr>'}</table>
  `, { active: '/' }));
});

const server = http.createServer(app);
server.listen(PORT, HOST, () => {
  console.log(`세타온 본부가 켜졌습니다: http://${HOST}:${PORT}  (끄려면 Ctrl + C)`);
});

module.exports = { app, server };
