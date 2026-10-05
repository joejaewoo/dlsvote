import { submitBallot, voterHash } from '../lib/storage.js';
import { validateBallot } from '../lib/polls.js';
import { json, failure, body, sameOrigin } from '../lib/http.js';
export default { async fetch(request) {
  if (request.method !== 'POST') return json({ error: '지원하지 않는 요청입니다.' }, 405);
  try {
    sameOrigin(request);
    const data = await body(request);
    const error = validateBallot(data);
    if (error) return json({ error }, 400);
    const result = await submitBallot(data.poll, data.round, voterHash(data.voter), data.choices);
    return json({ ok: true, duplicate: !result.inserted, choices: result.choices, poll: data.poll, round: data.round });
  } catch (error) { return failure(error); }
}};
