import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, appendFile } from 'node:fs/promises';

export const workbook = resolve(process.env.EXCEL_FILE || 'requests.xlsx');
export const traces = [];
let client;
let connecting;
export async function connect() {
  if (client) return client;
  if (!connecting) connecting = (async () => {
    const transport = new StdioClientTransport({ command: resolve('.venv/Scripts/excel-mcp-server.exe'), args: ['stdio', '--allow-dir', process.cwd()], stderr: 'inherit' });
    const c = new Client({ name: 'repair-requests-agent', version: '1.0.0' });
    await c.connect(transport);
    client = c;
    return c;
  })().catch(e => { connecting = undefined; throw e; });
  return connecting;
}
export async function close() { await client?.close(); client = undefined; connecting = undefined; }

export async function call(tool, args, source = 'application') {
  const entry = { id: randomUUID(), time: new Date().toISOString(), source, tool, arguments: args, status: 'requested' };
  traces.push(entry);
  console.log('[MCP →]', JSON.stringify(entry));
  try {
    const c = await connect();
    entry.result = await c.callTool({ name: tool, arguments: args }, undefined, { timeout: 30000 });
    const data = unpack(entry.result);
    if (data.error || data.status === 'error') throw new Error(JSON.stringify(data));
    entry.status = 'completed';
    return data;
  } catch (e) { entry.status = 'failed'; entry.error = e.message; throw e; }
  finally {
    console.log('[MCP ←]', JSON.stringify(entry));
    await mkdir('artifacts', { recursive: true });
    await appendFile('artifacts/mcp-trace.jsonl', JSON.stringify(entry) + '\n');
  }
}

export function unpack(result) {
  if (result.isError) throw new Error(JSON.stringify(result.content));
  if (result.structuredContent) return result.structuredContent;
  const content = result.content?.filter(p => p.type === 'text').map(p => p.text).join('\n');
  if (!content) throw new Error('MCP вернул пустой результат');
  try { return JSON.parse(content); } catch { return { text: content }; }
}
