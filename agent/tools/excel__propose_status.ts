import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { excel } from '../lib/excel';
export default defineTool({
  description: 'Найти заявку через MCP read_range и подготовить смену статуса для подтверждения человеком. НЕ изменяет файл. Передавай ID или точное имя в именительном падеже. При нескольких совпадениях спроси ID. После этого пользователь нажимает кнопку подтверждения в приложении.',
  inputSchema: z.object({ id: z.number().int().optional(), client: z.string().optional(), status: z.enum(['Новый', 'В работе', 'Готово']) }),
  execute: (input, ctx) => excel('propose', input, ctx.session.id),
});
