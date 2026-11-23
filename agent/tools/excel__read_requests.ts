import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { excel } from '../lib/excel';
export default defineTool({
  description: 'Прочитать актуальные заявки через MCP read_range, при необходимости отфильтровать по статусу. Возвращает строки и количество.',
  inputSchema: z.object({ status: z.enum(['Новый', 'В работе', 'Готово']).optional() }),
  execute: (input, ctx) => excel('read', input, ctx.session.id),
});
