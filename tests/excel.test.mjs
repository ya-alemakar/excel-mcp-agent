import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.EXCEL_FILE = 'artifacts/integration.xlsx';
const { call, close, workbook, traces } = await import('../lib/mcp.mjs');
const { seed, readRequests, addRequest, proposeUpdate, getPending, confirmUpdate, listRequests } = await import('../lib/requests.mjs');

test('реальный Excel MCP: добавление, подтверждение, фильтр и ошибки без побочных изменений', async () => {
  try {
    await call('create_workbook', { path: workbook, sheets: ['Заявки'], overwrite: true }, 'test-setup');
    await call('write_range', { path: workbook, sheet: 'Заявки', at: 'A1', rows: seed }, 'test-setup');
    const original = await readRequests('test');
    await assert.rejects(addRequest({ client: 'Анна Смирнова', problem: 'Ноутбук сильно тормозит', suggestedId: 999 }, 'test'), /неверный ID/);
    const added = await addRequest({ client: 'Анна Смирнова', problem: 'Ноутбук сильно тормозит' }, 'test');
    assert.equal(added.created.id, 104);
    assert.equal(added.created.status, 'Новый');
    const before = await readRequests('test');
    await proposeUpdate({ id: 104, status: 'В работе' }, 'test-session');
    assert.deepEqual(await readRequests('test'), before, 'Предложение не изменяет файл');
    const [p] = getPending('test-session');
    await assert.rejects(confirmUpdate(p.token, 'another-session', true));
    const confirmed = await confirmUpdate(p.token, 'test-session', true);
    assert.equal(confirmed.verified, true);
    await assert.rejects(confirmUpdate(p.token, 'test-session', true), 'Токен одноразовый');
    const working = await listRequests({ status: 'В работе' }, 'test');
    assert.deepEqual(working.rows.map(r => r.id), [102, 104]);
    const stable = await readRequests('test');
    const start = traces.length;
    assert.match((await proposeUpdate({ id: 999, status: 'Готово' }, 'test-session')).error, /не найдена/);
    await assert.rejects(addRequest({ client: 'Дмитрий' }, 'test'), /Проблема/);
    assert.equal(traces.slice(start).filter(t => t.tool === 'write_range').length, 0);
    assert.deepEqual(await readRequests('test'), stable);
    assert.deepEqual(stable.slice(0, 3), original, 'Исходные записи сохранены');
    await proposeUpdate({ id: 104, status: 'Готово' }, 'cancel-session');
    await confirmUpdate(getPending('cancel-session')[0].token, 'cancel-session', false);
    assert.deepEqual(await readRequests('test'), stable, 'Отмена не меняет файл');
    await proposeUpdate({ id: 104, status: 'Готово' }, 'conflict-session');
    await call('write_range', { path: workbook, sheet: 'Заявки', at: 'D5', rows: [['Новый']] }, 'external-edit-test');
    await assert.rejects(confirmUpdate(getPending('conflict-session')[0].token, 'conflict-session', true), /изменилась/);
    const created = await Promise.all([addRequest({ client: 'Тест Один', problem: 'Проверка один' }, 'test'), addRequest({ client: 'Тест Два', problem: 'Проверка два' }, 'test')]);
    assert.deepEqual(created.map(r => r.created.id), [105, 106], 'Параллельные добавления не повторяют ID');
  } finally { await close(); }
});
