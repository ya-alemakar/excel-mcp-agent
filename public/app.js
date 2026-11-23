let sessionId;
let busy = false;
const $ = id => document.getElementById(id);
const traceNodes = new Map();
function message(text, role) {
  const el = document.createElement('article'); el.className = role; el.textContent = text;
  $('messages').append(el); $('messages').scrollTop = $('messages').scrollHeight; return el;
}
function renderRows(target, rows) {
  target.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const field of ['id', 'client', 'problem', 'status']) {
      const td = document.createElement('td');
      if (field === 'status') { const span = document.createElement('span'); span.className = 'badge ' + (row.status === 'В работе' ? 'work' : row.status === 'Готово' ? 'done' : ''); span.textContent = row.status; td.append(span); }
      else td.textContent = row[field];
      tr.append(td);
    }
    target.append(tr);
  }
}
async function request(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error((await response.json()).error || 'Ошибка приложения');
  return response;
}
const post = (path, data) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
async function refresh() {
  $('table-status').textContent = 'Чтение через MCP…';
  try { const data = await (await request('/api/requests')).json(); renderRows($('rows'), data.rows); $('count').textContent = `· ${data.count}`; $('table-status').textContent = `Актуально на ${new Date().toLocaleTimeString('ru-RU')}`; }
  catch (e) { $('table-status').textContent = 'Не удалось обновить. Показанные данные могут быть устаревшими: ' + e.message; }
  await trace();
}
async function trace() {
  try {
    const calls = await (await request('/api/traces')).json();
    if (calls.length && !traceNodes.size) $('trace').replaceChildren();
    for (const call of calls) {
      const fingerprint = JSON.stringify(call);
      if (traceNodes.get(call.id)?.fingerprint === fingerprint) continue;
      const old = traceNodes.get(call.id)?.el;
      const el = document.createElement('div'); el.className = 'call';
      const name = document.createElement('strong'); name.textContent = call.tool;
      const status = document.createElement('p'); status.textContent = `${call.source} · ${call.status === 'completed' ? '✓ Выполнен' : call.status === 'failed' ? 'Ошибка' : 'Выполняется…'}`;
      const details = document.createElement('details'); details.open = old?.querySelector('details')?.open || false;
      const summary = document.createElement('summary'); summary.textContent = 'Параметры и результат';
      const raw = document.createElement('pre'); raw.textContent = JSON.stringify({ time: call.time, arguments: call.arguments, result: call.result, error: call.error }, null, 2);
      details.append(summary, raw); el.append(name, status, details);
      if (old) old.replaceWith(el); else $('trace').prepend(el);
      traceNodes.set(call.id, { el, fingerprint });
    }
  } catch {}
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('button,input').forEach(el => { el.disabled = value; });
}
function pending(items) {
  $('pending').replaceChildren();
  for (const p of items) {
    const el = document.createElement('div'); el.className = 'confirmation';
    const title = document.createElement('strong'); title.textContent = `Подтвердите изменение заявки №${p.record.id}`;
    const info = document.createElement('p'); info.textContent = `${p.record.client} · ${p.record.problem}\nСтатус: «${p.record.status}» → «${p.status}». Срок подтверждения — 10 минут.`;
    el.append(title, info);
    for (const [label, approve] of [['Подтвердить изменение', true], ['Отмена', false]]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (!approve) b.className = 'secondary';
      b.onclick = async () => {
        if (busy) return;
        setBusy(true);
        try {
          const result = await (await post('/api/confirm', { token: p.token, sessionId, approve })).json();
          message(result.message, 'assistant'); el.remove(); $('selection').hidden = true;
          await refresh();
        } catch (e) { message(e.message, 'assistant error'); el.remove(); }
        finally { setBusy(false); }
      };
      el.append(b);
    }
    $('pending').append(el);
  }
}
async function submit(text) {
  if (busy || !text.trim()) return;
  setBusy(true); $('message').value = ''; $('selection').hidden = true;
  message(text, 'user'); const answer = message('Агент обрабатывает запрос…', 'assistant');
  try {
    const response = await post('/api/chat', { message: text, sessionId });
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let answered = false;
    const handle = e => {
      if (e.type === 'session') sessionId = e.sessionId;
      if (e.type === 'agent-tool') $('agent-action').textContent = `Агент выбрал: ${e.tool}`;
      if (e.type === 'answer' || e.type === 'error') { answered = true; answer.textContent = e.text; answer.className = e.type === 'error' || !e.ok ? 'assistant error' : 'assistant'; }
      if (e.type === 'selection') { renderRows($('selection-rows'), e.rows); $('selection-count').textContent = `Найдено заявок: ${e.count}${e.status ? ` · ${e.status}` : ''}`; $('selection').hidden = false; }
      if (e.type === 'pending') pending(e.items);
    };
    while (true) {
      const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) if (line.trim()) handle(JSON.parse(line));
      if (done) { if (buffer.trim()) handle(JSON.parse(buffer)); break; }
    }
    if (!answered) throw new Error('Соединение прервалось. Обновите данные перед повтором.');
    await refresh();
  } catch (e) { answer.textContent = e.message; answer.className = 'assistant error'; }
  finally { setBusy(false); $('message').focus(); await trace(); }
}
$('form').addEventListener('submit', e => { e.preventDefault(); void submit($('message').value); });
document.querySelectorAll('[data-question]').forEach(b => b.onclick = () => void submit(b.dataset.question));
$('refresh').onclick = () => void refresh();
$('reset').onclick = () => { sessionId = undefined; $('messages').replaceChildren(); $('pending').replaceChildren(); $('selection').hidden = true; message('Новый разговор. Что нужно сделать с заявками?', 'assistant'); };
fetch('/api/status').then(r => r.json()).then(s => { $('status').textContent = s.configured ? `Модель: ${s.model} · Excel MCP по stdio · ${s.workbook}` : 'Добавьте OPENAI_API_KEY или AI_GATEWAY_API_KEY в .env. Просмотр таблицы доступен без ключа.'; });
void refresh(); setInterval(() => void trace(), 1500);
