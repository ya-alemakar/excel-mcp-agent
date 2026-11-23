import { randomUUID } from 'node:crypto';
import { call, workbook } from './mcp.mjs';

export const headers = ['ID', 'Клиент', 'Проблема', 'Статус'];
export const seed = [headers, [101, 'Иван Петров', 'Ноутбук не включается', 'Новый'], [102, 'Мария Соколова', 'Принтер не печатает', 'В работе'], [103, 'Олег Иванов', 'Мерцает монитор', 'Готово']];
const base = { path: workbook, sheet: 'Заявки' };
const statuses = ['Новый', 'В работе', 'Готово'];
const pending = new Map();
let queue = Promise.resolve();
export function transaction(fn) {
  const result = queue.then(fn);
  queue = result.catch(() => {});
  return result;
}
function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Уточните поле «${field}»`);
  const clean = value.trim();
  if (clean.length > 500 || /^[=+@\-]/.test(clean)) throw new Error(`Недопустимое значение поля «${field}»`);
  return clean;
}
export async function readRequests(source = 'table') {
  const values = [];
  let range;
  do {
    const page = await call('read_range', { ...base, ...(range ? { range } : {}), max_cells: 2000 }, source);
    if (!Array.isArray(page.values)) throw new Error('MCP не вернул строки листа');
    values.push(...page.values);
    range = page.next_range;
  } while (range);
  if (JSON.stringify(values[0]) !== JSON.stringify(headers)) throw new Error('Ожидаются столбцы ID, Клиент, Проблема, Статус в A1:D1');
  const rows = values.slice(1).map((r, i) => ({ id: r[0], client: r[1], problem: r[2], status: r[3], row: i + 2 })).filter(r => r.id != null || r.client != null || r.problem != null || r.status != null);
  const ids = new Set();
  for (const r of rows) {
    if (!Number.isSafeInteger(r.id) || ids.has(r.id) || !r.client || !r.problem || !statuses.includes(r.status)) throw new Error('В Excel есть неполные строки, неверные статусы или повторяющиеся ID');
    ids.add(r.id);
  }
  return rows;
}
export async function listRequests({ status } = {}, source = 'agent') {
  return transaction(async () => {
    const rows = await readRequests(source);
    const found = status ? rows.filter(r => r.status === status) : rows;
    return { rows: found, count: found.length, status: status || null };
  });
}
export function addRequest(input, source = 'agent') {
  return transaction(async () => {
    const client = text(input.client, 'Клиент');
    const problem = text(input.problem, 'Проблема');
    const before = await readRequests(source);
    const id = Math.max(100, ...before.map(r => r.id)) + 1;
    if (input.suggestedId != null && input.suggestedId !== id) throw new Error('Таблица изменилась или выбран неверный ID. Прочитайте заявки заново и выберите max(ID)+1. Запись не выполнена.');
    const row = Math.max(1, ...before.map(r => r.row)) + 1;
    await call('write_range', { ...base, at: `A${row}`, rows: [[id, client, problem, 'Новый']] }, source);
    const after = await readRequests(source);
    const created = after.find(r => r.id === id);
    if (!created || created.client !== client || created.problem !== problem || created.status !== 'Новый' || after.length !== before.length + 1 || !before.every(r => JSON.stringify(after.find(a => a.id === r.id)) === JSON.stringify(r))) throw new Error('Запись отправлена, но проверка не пройдена. Обновите таблицу перед повтором.');
    return { created, verified: true };
  });
}
export function proposeUpdate(input, sessionId) {
  return transaction(async () => {
    if (!statuses.includes(input.status)) throw new Error('Допустимые статусы: Новый, В работе, Готово');
    const all = await readRequests('agent');
    const needle = input.client?.trim().toLocaleLowerCase('ru');
    const found = all.filter(r => input.id != null ? r.id === input.id : needle && r.client.toLocaleLowerCase('ru') === needle);
    if (found.length !== 1) return { error: found.length ? 'Найдено несколько заявок. Уточните ID.' : 'Заявка не найдена. Ничего не изменено.', count: found.length, rows: found };
    const record = found[0];
    if (record.status === input.status) return { unchanged: true, record, message: 'Этот статус уже установлен.' };
    // Only the browser confirmation route can consume this opaque token. The LLM cannot write an existing row.
    for (const [key, p] of pending) if (p.sessionId === sessionId) pending.delete(key);
    const proposal = { token: randomUUID(), sessionId, record, status: input.status, expires: Date.now() + 10 * 60 * 1000 };
    pending.set(proposal.token, proposal);
    return { requiresConfirmation: true, record, newStatus: input.status, message: 'Изменения ещё не внесены. Подтвердите запись кнопкой в приложении.' };
  });
}
export function getPending(sessionId) {
  return [...pending.values()].filter(p => p.sessionId === sessionId && p.expires > Date.now()).map(({ sessionId: _, ...p }) => p);
}
export function confirmUpdate(token, sessionId, approve) {
  return transaction(async () => {
    const p = pending.get(token);
    if (!p || p.sessionId !== sessionId || p.expires < Date.now()) throw new Error('Подтверждение недействительно или устарело. Повторите запрос.');
    pending.delete(token);
    if (!approve) return { cancelled: true, message: 'Изменение отменено.' };
    const before = await readRequests('confirmation');
    const record = before.find(r => r.id === p.record.id);
    if (JSON.stringify(record) !== JSON.stringify(p.record)) throw new Error('Заявка изменилась после запроса. Запросите изменение заново.');
    await call('write_range', { ...base, at: `D${record.row}`, rows: [[p.status]] }, 'confirmation');
    const after = await readRequests('verification');
    const expected = before.map(r => r.id === record.id ? { ...r, status: p.status } : r);
    if (JSON.stringify(after) !== JSON.stringify(expected)) throw new Error('Запись отправлена, но проверка не пройдена. Обновите таблицу.');
    return { verified: true, record: after.find(r => r.id === record.id), message: `Статус заявки №${record.id} (${record.client}) изменён с «${record.status}» на «${p.status}». Данные проверены через MCP.` };
  });
}
