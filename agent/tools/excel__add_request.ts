import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { excel } from '../lib/excel';
export default defineTool({
  description: 'Добавить заявку через MCP: read_range → выбор свободного ID → write_range новой строки → read_range проверки. Нужны реальное имя клиента и непустое описание проблемы от пользователя. Статус Новый.',
  inputSchema: z.object({ client: z.string().min(1), problem: z.string().min(1), suggestedId: z.number().int().min(101).describe('Сначала прочитай заявки через excel__read_requests и вычисли max(ID)+1') }),
  execute: (input, ctx) => excel('add', input, ctx.session.id),
});
