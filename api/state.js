import { snapshot, voterHash } from '../lib/storage.js';
import { brand, tagline, eventTitle, polls, tally, validToken } from '../lib/polls.js';
import { json, failure } from '../lib/http.js';
export default { async fetch(request) {
  if (request.method !== 'GET') return json({ error: '지원하지 않는 요청입니다.' }, 405);
  try {
    const voter = request.headers.get('x-live-voter');
    const state = await snapshot(validToken(voter) ? voterHash(voter) : null);
    return json({ version: 2, brand, tagline, eventTitle, polls: polls.map(poll => {
      const current = state.states.find(row => row.id === poll.id);
      return { ...tally(poll, current.ballots), round: current.round, closed: current.closed,
        participants: current.ballots.length, own: current.own || null };
    }), updatedAt: Date.now(), local: state.local });
  } catch (error) { return failure(error); }
}};
