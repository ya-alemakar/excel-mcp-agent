import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { Client } from 'eve/client';
import { close, traces, workbook } from './lib/mcp.mjs';
import { listRequests, addRequest, proposeUpdate, getPending, confirmUpdate } from './lib/requests.mjs';

const client = new Client({ baseUrl: 'http://127.0.0.1:2000' });
const sessions = new Map();
const active = new Set();
const files = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'] };
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (data.length > 16000) throw new Error('Слишком длинный запрос'); }
  return JSON.parse(data);
}
const server = http.createServer(async (req, res) => {
  const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    if (!['127.0.0.1:3000', 'localhost:3000'].includes(req.headers.host)) return json(403, { error: 'Недопустимый Host' });
    if (req.method === 'POST' && req.headers.origin && !['http://127.0.0.1:3000', 'http://localhost:3000'].includes(req.headers.origin)) return json(403, { error: 'Недопустимый источник' });
    if (req.method === 'GET' && req.url === '/api/status') return json(200, { configured: Boolean(process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY), model: process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL || 'gpt-6.1-sol' : process.env.AGENT_MODEL || 'openai/gpt-6.1-sol', workbook });
    if (req.method === 'GET' && req.url === '/api/requests') return json(200, await listRequests({}, 'table-refresh'));
    if (req.method === 'GET' && req.url === '/api/traces') return json(200, traces.slice(-200));
    if (req.method === 'POST' && req.url === '/internal/excel') {
      if (!process.env.INTERNAL_TOKEN || req.headers.authorization !== `Bearer ${process.env.INTERNAL_TOKEN}`) return json(403, { error: 'Нет доступа' });
      const { action, input, sessionId } = await body(req);
      if (!sessions.has(sessionId)) return json(403, { error: 'Неизвестная сессия' });
      if (action === 'read') return json(200, await listRequests(input));
      if (action === 'add') return json(200, await addRequest(input));
      if (action === 'propose') return json(200, await proposeUpdate(input, sessionId));
      return json(400, { error: 'Неизвестное действие' });
    }
    if (req.method === 'POST' && req.url === '/api/confirm') {
      const { token, sessionId, approve } = await body(req);
      if (typeof approve !== 'boolean') return json(400, { error: 'Нужно явное подтверждение или отмена' });
      if (active.has(sessionId)) return json(409, { error: 'Дождитесь ответа агента' });
      const result = await confirmUpdate(token, sessionId, approve);
      return json(200, result);
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      const data = await body(req);
      if (typeof data.message !== 'string' || !data.message.trim() || data.message.length > 2000) return json(400, { error: 'Введите сообщение длиной до 2000 символов' });
      if (!process.env.OPENAI_API_KEY && !process.env.AI_GATEWAY_API_KEY) return json(503, { error: 'Укажите ключ модели в .env и перезапустите npm start. Таблица и MCP доступны без ключа.' });
      if (data.sessionId && !sessions.has(data.sessionId)) return json(400, { error: 'Сессия устарела. Начните новый чат.' });
      if (active.has(data.sessionId)) return json(409, { error: 'Дождитесь предыдущего ответа' });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
      const send = event => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
      let sessionId;
      let timer;
      try {
        let session, delivery;
        if (data.sessionId) { session = sessions.get(data.sessionId); delivery = await session.send(data.message); }
        else ({ session, delivery } = await client.sessions.create({ message: data.message }));
        sessionId = delivery.sessionId;
        sessions.set(sessionId, session); active.add(sessionId);
        send({ type: 'session', sessionId });
        timer = setTimeout(() => { void session.cancel().catch(() => {}); }, 120000);
        let selection;
        let failed = false;
        for await (const event of delivery.stream()) {
          if (event.type === 'call.requested' && event.data.capability?.name?.startsWith('excel__')) send({ type: 'agent-tool', tool: event.data.capability.name, input: event.data.input });
          if (event.type === 'call.settled') {
            if (event.data.outcome === 'failed') failed = true;
            const output = event.data.output;
            if (Array.isArray(output?.rows) && Number.isInteger(output?.count)) selection = output;
          }
        }
        const result = await delivery.result();
        if (result.status !== 'completed') throw new Error('Модель не завершила запрос. Проверьте ключ и соединение.');
        send({ type: 'answer', text: failed ? 'Операция завершилась ошибкой. Проверьте журнал MCP и обновите таблицу перед повтором.\n' + (result.reply || '') : result.reply, ok: !failed });
        if (selection) send({ type: 'selection', ...selection });
        send({ type: 'pending', items: getPending(sessionId) });
      } catch (e) { console.error('[AGENT]', e.message); send({ type: 'error', text: e.message }); }
      finally { clearTimeout(timer); active.delete(sessionId); res.end(); }
      return;
    }
    if (req.method === 'GET' && files[req.url]) {
      const [path, type] = files[req.url];
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(await readFile(new URL(path, import.meta.url))); return;
    }
    json(404, { error: 'Не найдено' });
  } catch (e) { console.error(e.message); if (!res.headersSent) json(400, { error: e.message }); else res.end(); }
});
server.listen(3000, '127.0.0.1', () => console.log('Заявки: http://127.0.0.1:3000'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); void close().finally(() => process.exit()); });
