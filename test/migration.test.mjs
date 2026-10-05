import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('legacy active answers are preserved as two separate polls and migration runs once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'live-migration-'));
  process.env.VOTER_SECRET = 'legacy-fixed-secret-2026';
  process.env.ADMIN_PASSWORD = '9876';
  process.env.LOCAL_DB_PATH = join(directory, 'migration.sqlite');
  delete process.env.DATABASE_URL; delete process.env.VERCEL; delete process.env.NODE_ENV;
  const db = new DatabaseSync(process.env.LOCAL_DB_PATH);
  db.exec('CREATE TABLE joy_event(id TEXT PRIMARY KEY,active_round TEXT,closed INTEGER); CREATE TABLE joy_ballots(round TEXT,voter_hash TEXT,answers TEXT);');
  const voter = randomUUID(), active = randomUUID();
  const hash = createHmac('sha256', process.env.VOTER_SECRET).update(voter).digest('hex');
  const answers = { dinner: ['스시','마라탕','김치찌개'], academy: ['관리','커리큘럼','원비'] };
  db.prepare('INSERT INTO joy_event VALUES (?,?,?)').run('main', active, 1);
  db.prepare('INSERT INTO joy_ballots VALUES (?,?,?)').run(active, hash, JSON.stringify(answers));
  db.prepare('INSERT INTO joy_ballots VALUES (?,?,?)').run(randomUUID(), hash, JSON.stringify(answers));
  const { snapshot, voterHash, operate, initialize } = await import('../lib/storage.js');
  let current = await snapshot(voterHash(voter));
  assert.equal(current.states.length, 2);
  for (const poll of current.states) {
    assert.equal(poll.ballots.length, 1);
    assert.equal(poll.closed, true);
    assert.deepEqual(poll.own, answers[poll.id]);
  }
  const dinner = current.states.find(poll => poll.id === 'dinner');
  await operate('new-round', 'dinner', dinner.round);
  await initialize();
  current = await snapshot(voterHash(voter));
  assert.equal(current.states.find(poll => poll.id === 'dinner').ballots.length, 0);
  assert.equal(current.states.find(poll => poll.id === 'academy').ballots.length, 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM joy_ballots').get().count, 2);
  db.close(); rmSync(directory, { recursive:true, force:true });
});
