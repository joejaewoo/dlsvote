import { createHash, timingSafeEqual } from 'node:crypto';
import { operate, VoteError } from '../lib/storage.js';
import { validToken, findPoll } from '../lib/polls.js';
import { json, failure, body, sameOrigin } from '../lib/http.js';
export default { async fetch(request) {
  if (request.method !== 'POST') return json({ error: '지원하지 않는 요청입니다.' }, 405);
  try {
    sameOrigin(request);
    const data = await body(request);
    const password = process.env.ADMIN_PASSWORD;
    if (!password || password.length < 4) throw new VoteError('운영 비밀번호 설정이 필요합니다.', 503);
    const digest = value => createHash('sha256').update(value).digest();
    if (typeof data.password !== 'string' || !timingSafeEqual(digest(data.password), digest(password))) throw new VoteError('운영 비밀번호가 맞지 않습니다.', 401);
    if (data.action !== 'verify') {
      if (!validToken(data.round) || !findPoll(data.poll)) throw new VoteError('새로고침 후 다시 시도해주세요.');
      await operate(data.action, data.poll, data.round);
    }
    return json({ ok: true });
  } catch (error) { return failure(error); }
}};
