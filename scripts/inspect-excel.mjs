import { connect, close } from '../lib/mcp.mjs';
import { writeFile } from 'node:fs/promises';
try {
  const c = await connect();
  const tools = await c.listTools();
  await writeFile('artifacts/excel-tools.json', JSON.stringify(tools, null, 2));
  console.log(JSON.stringify(tools.tools.filter(x => ['create_workbook','create_sheet','read_range','write_range','describe_sheet','format_range','set_sheet_layout'].includes(x.name)), null, 2));
} finally { await close(); }
