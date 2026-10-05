import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'live-vote-'));
process.env.ADMIN_PASSWORD = '9876';
process.env.VOTER_SECRET = 'test-voter-secret-2026';
process.env.LOCAL_DB_PATH = join(directory, 'test.sqlite');
delete process.env.DATABASE_URL;
delete process.env.VERCEL;
delete process.env.NODE_ENV;
const { default: state } = await import('../api/state.js');
const { default: vote } = await import('../api/vote.js');
const { default: admin } = await import('../api/admin.js');
const { voterHash } = await import('../lib/storage.js');
const dinner = ['스시', '마라탕', '김치찌개'];
const academy = ['관리', '커리큘럼', '원비'];
const voter = randomUUID();
const get = async token => (await state.fetch(new Request('http://localhost/api/state', { headers: token ? { 'X-Live-Voter': token } : {} }))).json();
const post = (endpoint, payload, origin = 'http://localhost') => endpoint.fetch(new Request('http://localhost/api/' + (endpoint === vote ? 'vote' : 'admin'), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(payload) }));
const poll = (current, id) => current.polls.find(item => item.id === id);
const operate = async (action, id, round) => post(admin, { action, poll: id, round, password: process.env.ADMIN_PASSWORD });
after(() => rmSync(directory, { recursive: true, force: true }));

test('dinner retries count once and the same browser can independently vote in academy', async () => {
  let current = await get();
  const payload = { voter, poll: 'dinner', round: poll(current, 'dinner').round, choices: dinner };
  const responses = await Promise.all(Array.from({ length: 25 }, () => post(vote, payload)));
  assert(responses.every(response => response.status === 200));
  current = await get(voter);
  assert.equal(poll(current, 'dinner').participants, 1);
  assert.equal(poll(current, 'academy').participants, 0);
  assert.deepEqual(poll(current, 'dinner').own, dinner);
  assert.equal(poll(current, 'academy').own, null);
  const retry = await (await post(vote, { ...payload, choices: ['삼겹살', '족발', '파스타'] })).json();
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.choices, dinner);
  assert.equal((await post(vote, { voter, poll: 'academy', round: poll(current, 'academy').round, choices: academy })).status, 200);
  current = await get(voter);
  assert.equal(poll(current, 'dinner').participants, 1);
  assert.equal(poll(current, 'academy').participants, 1);
  assert.deepEqual(poll(current, 'academy').own, academy);
  assert.deepEqual(poll(current, 'dinner').own, dinner);
});

test('invalid choices, cross-origin requests and a round from the other poll are rejected', async () => {
  const current = await get();
  const round = poll(current, 'dinner').round;
  for (const choices of [['스시'], ['스시', '스시', '마라탕'], ['스시', '마라탕', '없는항목'], ['스시', '마라탕', '김치찌개', '쌀국수']]) {
    assert.equal((await post(vote, { voter: randomUUID(), poll: 'dinner', round, choices })).status, 400);
  }
  assert.equal((await post(vote, { voter: randomUUID(), poll: 'dinner', round, choices: dinner }, 'https://unrelated.example')).status, 403);
  assert.equal((await post(vote, { voter: randomUUID(), poll: 'academy', round, choices: academy })).status, 409);
  const next = await get();
  assert.equal(poll(next, 'dinner').participants, 1);
  assert.equal(poll(next, 'academy').participants, 1);
});

test('dinner ballots animate a shared ranking without increasing academy totals', async () => {
  const current = await get();
  const round = poll(current, 'dinner').round;
  const responses = await Promise.all(Array.from({ length: 35 }, () => post(vote, { voter: randomUUID(), poll: 'dinner', round, choices: ['파스타', '삼겹살', '족발'] })));
  assert(responses.every(response => response.status === 200));
  const next = await get();
  assert.equal(poll(next, 'dinner').participants, 36);
  assert.equal(poll(next, 'dinner').total, 108);
  assert.equal(poll(next, 'dinner').results[0].votes, 35);
  assert.equal(poll(next, 'academy').participants, 1);
  assert.equal(poll(next, 'academy').total, 3);
});

test('four digit password, independent closure, new rounds and stale QR protection', async () => {
  let current = await get();
  const dinnerRound = poll(current, 'dinner').round;
  const academyRound = poll(current, 'academy').round;
  assert.equal((await post(admin, { action: 'verify', password: '9876' })).status, 200);
  assert.equal((await post(admin, { action: 'close', poll: 'dinner', round: dinnerRound, password: 'wrong' })).status, 401);
  assert.equal((await operate('close', 'dinner', dinnerRound)).status, 200);
  assert.equal((await post(vote, { voter: randomUUID(), poll: 'dinner', round: dinnerRound, choices: dinner })).status, 409);
  assert.equal((await post(vote, { voter, poll: 'dinner', round: dinnerRound, choices: dinner })).status, 200);
  assert.equal((await post(vote, { voter: randomUUID(), poll: 'academy', round: academyRound, choices: academy })).status, 200);
  current = await get();
  assert.equal(poll(current, 'academy').closed, false);
  assert.equal(poll(current, 'academy').participants, 2);
  assert.equal((await operate('new-round', 'dinner', dinnerRound)).status, 200);
  current = await get(voter);
  assert.notEqual(poll(current, 'dinner').round, dinnerRound);
  assert.equal(poll(current, 'dinner').participants, 0);
  assert.equal(poll(current, 'dinner').own, null);
  assert.equal(poll(current, 'academy').round, academyRound);
  assert.equal(poll(current, 'academy').participants, 2);
  assert.deepEqual(poll(current, 'academy').own, academy);
  assert.equal((await post(vote, { voter, poll: 'dinner', round: dinnerRound, choices: dinner })).status, 409);
  assert.equal((await operate('close', 'dinner', dinnerRound)).status, 409);
  assert.equal((await post(vote, { voter, poll: 'dinner', round: poll(current, 'dinner').round, choices: dinner })).status, 200);
});

test('changing the admin password preserves anonymous voter identity', async () => {
  const before = voterHash(voter);
  process.env.ADMIN_PASSWORD = '2468';
  assert.equal(voterHash(voter), before);
  assert.equal((await post(admin, { action: 'verify', password: '9876' })).status, 401);
  assert.equal((await post(admin, { action: 'verify', password: '2468' })).status, 200);
  process.env.ADMIN_PASSWORD = '9876';
  const current = await get(voter);
  assert.deepEqual(poll(current, 'academy').own, academy);
});
