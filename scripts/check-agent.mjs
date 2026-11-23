import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const transcript = { checkedAt: new Date().toISOString(), mode: 'real LLM + stdio Excel MCP', turns: [] };
const base = 'http://127.0.0.1:3000';
let sessionId;
const post = async (path, data) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(150000) });
  if (!r.ok) throw new Error(await r.text());
  return r;
};
async function chat(message) {
  console.log('Пользователь:', message);
  const r = await post('/api/chat', { message, sessionId });
  const events = (await r.text()).trim().split('\n').map(JSON.parse);
  sessionId = events.find(e => e.type === 'session')?.sessionId;
  transcript.turns.push({ message, events });
  const answer = events.find(e => e.type === 'answer');
  assert.ok(answer?.ok, JSON.stringify(events));
  console.log('Агент:', answer.text);
  return events;
}
async function rows() { return (await (await fetch(base + '/api/requests')).json()).rows; }
try {
  const original = await rows();
  assert.deepEqual(original.map(r => r.id), [101, 102, 103], 'Для демонстрации нужен исходный файл с тремя заявками. Существующие данные не сбрасываются автоматически.');
  const addition = await chat('Добавь заявку от Анны Смирновой: ноутбук сильно тормозит');
  const choices = addition.filter(e => e.type === 'agent-tool');
  assert.deepEqual(choices.map(e => e.tool), ['excel__read_requests', 'excel__add_request']);
  assert.equal(choices[1].input.suggestedId, 104, 'ID предложен моделью после чтения MCP');
  let current = await rows();
  assert.equal(current.length, 4); assert.equal(current[3].id, 104); assert.equal(current[3].client, 'Анна Смирнова'); assert.equal(current[3].status, 'Новый');
  const before = current;
  const update = await chat('Измени статус заявки Анны Смирновой на «В работе»');
  assert.deepEqual(await rows(), before, 'До подтверждения файл неизменен');
  const proposal = update.find(e => e.type === 'pending')?.items?.[0];
  assert.equal(proposal.record.id, 104);
  const confirmation = await (await post('/api/confirm', { token: proposal.token, sessionId, approve: true })).json();
  transcript.confirmation = confirmation;
  assert.equal(confirmation.verified, true);
  current = await rows();
  assert.deepEqual(current, before.map(r => r.id === 104 ? { ...r, status: 'В работе' } : r));
  const list = await chat('Покажи все заявки со статусом «В работе»');
  const selection = list.find(e => e.type === 'selection');
  assert.equal(selection?.count, 2); assert.deepEqual(selection.rows.map(r => r.id), [102, 104]);
  const stable = await rows();
  const missing = await chat('Измени статус заявки №999 на «Готово»');
  assert.match(missing.find(e => e.type === 'answer').text, /не найден|нет|отсутствует/i);
  assert.equal(missing.find(e => e.type === 'pending')?.items.length, 0);
  await chat('Добавь новую заявку от Дмитрия');
  assert.deepEqual(await rows(), stable, 'Ошибки и недостаточная информация не меняют Excel');
  transcript.finalRows = stable;
  transcript.mcp = await (await fetch(base + '/api/traces')).json();
  transcript.ok = true;
} catch (e) { transcript.ok = false; transcript.error = e.message; console.error(e.message); process.exitCode = 1; }
finally { await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/agent-check.json', JSON.stringify(transcript, null, 2)); }
