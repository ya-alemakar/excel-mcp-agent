import { access } from 'node:fs/promises';
import { call, close, workbook } from '../lib/mcp.mjs';
import { seed } from '../lib/requests.mjs';
try {
  let exists = false;
  try { await access(workbook); exists = true; } catch {}
  if (exists) console.log('Файл уже существует. Данные сохранены:', workbook);
  else {
    await call('create_workbook', { path: workbook, sheets: ['Заявки'] }, 'setup');
    await call('write_range', { path: workbook, sheet: 'Заявки', at: 'A1', rows: seed }, 'setup');
    await call('set_sheet_layout', { path: workbook, sheet: 'Заявки', layout: { column_widths_chars: { A: 10, B: 26, C: 44, D: 18 }, freeze_panes: 'A2' } }, 'setup');
    console.log('Создано:', workbook);
  }
} finally { await close(); }
