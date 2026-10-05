import { VoteError } from './storage.js';

export function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
export async function body(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new VoteError('올바른 요청 형식이 필요합니다.', 415);
  const text = await request.text();
  if (text.length > 4096) throw new VoteError('요청이 너무 큽니다.', 413);
  try { return JSON.parse(text); } catch { throw new VoteError('잘못된 요청입니다.'); }
}
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(request.url).origin !== origin) throw new VoteError('다른 사이트에서 제출할 수 없습니다.', 403);
}
export function failure(error) {
  if (error instanceof VoteError) return json({ error: error.message }, error.status);
  // Avoid logging connection strings, passwords, ballots, or participant tokens.
  console.error('Vote service failure:', error?.name || 'unknown');
  return json({ error: '연결이 잠시 지연되고 있습니다. 잠시 후 다시 시도해주세요.' }, 503);
}
