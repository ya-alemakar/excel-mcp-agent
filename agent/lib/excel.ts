export async function excel(action: string, input: unknown, sessionId: string) {
  const response = await fetch('http://127.0.0.1:3000/internal/excel', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.INTERNAL_TOKEN}` },
    body: JSON.stringify({ action, input, sessionId }), signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Ошибка Excel MCP');
  return result;
}
