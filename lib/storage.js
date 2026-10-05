import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { findPoll } from './polls.js';

export class VoteError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const initialRounds = { dinner: '8f1b4dea-6cd1-4b7f-9f38-dd51b58d3f1d', academy: 'ed5f461f-c49e-4ed9-bcdc-7346ae28c459' };
let ready, localDb, sql;
function secret() {
  const value = process.env.VOTER_SECRET;
  if (!value || value.length < 16) throw new VoteError('투표 저장소 설정이 필요합니다.', 503);
  return value;
}
export function voterHash(voter) {
  return createHmac('sha256', secret()).update(voter).digest('hex');
}
export async function initialize() {
  secret();
  if (ready) return ready;
  ready = (async () => {
    if (process.env.DATABASE_URL) {
      sql = neon(process.env.DATABASE_URL);
      await sql.transaction([
        sql.query("CREATE TABLE IF NOT EXISTS live_rounds (id UUID PRIMARY KEY, poll_id TEXT NOT NULL CHECK(poll_id IN ('dinner','academy')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"),
        sql.query("CREATE TABLE IF NOT EXISTS live_events (id TEXT PRIMARY KEY CHECK(id IN ('dinner','academy')), active_round UUID NOT NULL REFERENCES live_rounds(id), closed BOOLEAN NOT NULL DEFAULT FALSE)"),
        sql.query('CREATE TABLE IF NOT EXISTS live_ballots (round UUID NOT NULL REFERENCES live_rounds(id), voter_hash TEXT NOT NULL, choices JSONB NOT NULL, submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(round, voter_hash))'),
        sql.query('CREATE TABLE IF NOT EXISTS live_migrations (id TEXT PRIMARY KEY)'),
        ...Object.entries(initialRounds).flatMap(([poll, round]) => [
          sql.query('INSERT INTO live_rounds(id, poll_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [round, poll]),
          sql.query('INSERT INTO live_events(id, active_round) VALUES ($1,$2) ON CONFLICT DO NOTHING', [poll, round])
        ])
      ]);
      const [legacy] = await sql.query("SELECT to_regclass('public.joy_event') IS NOT NULL AND to_regclass('public.joy_ballots') IS NOT NULL AS present");
      if (legacy.present) {
        await sql.transaction([
          ...Object.entries(initialRounds).map(([poll, round]) => sql.query(`INSERT INTO live_ballots(round, voter_hash, choices, submitted_at)
            SELECT $1::uuid, b.voter_hash, b.answers->$2, b.submitted_at
            FROM joy_ballots b JOIN joy_event e ON b.round=e.active_round AND e.id='main'
            WHERE NOT EXISTS(SELECT 1 FROM live_migrations WHERE id='poll-split-v2')
            ON CONFLICT(round, voter_hash) DO NOTHING`, [round, poll])),
          sql.query(`UPDATE live_events SET closed=(SELECT closed FROM joy_event WHERE id='main')
            WHERE active_round IN ($1::uuid,$2::uuid) AND EXISTS(SELECT 1 FROM joy_event WHERE id='main')
            AND NOT EXISTS(SELECT 1 FROM live_migrations WHERE id='poll-split-v2')`, Object.values(initialRounds)),
          sql.query("INSERT INTO live_migrations(id) VALUES ('poll-split-v2') ON CONFLICT DO NOTHING")
        ]);
      }
    } else {
      if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new VoteError('투표 저장소 연결이 필요합니다. 운영자에게 알려주세요.', 503);
      const { DatabaseSync } = await import('node:sqlite');
      const path = process.env.LOCAL_DB_PATH || '.local/live.sqlite';
      mkdirSync(dirname(path), { recursive: true });
      localDb = new DatabaseSync(path);
      localDb.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS live_rounds (id TEXT PRIMARY KEY, poll_id TEXT NOT NULL CHECK(poll_id IN ('dinner','academy'))); CREATE TABLE IF NOT EXISTS live_events (id TEXT PRIMARY KEY CHECK(id IN ('dinner','academy')), active_round TEXT NOT NULL REFERENCES live_rounds(id), closed INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS live_ballots (round TEXT NOT NULL REFERENCES live_rounds(id), voter_hash TEXT NOT NULL, choices TEXT NOT NULL, PRIMARY KEY(round, voter_hash));");
      for (const [poll, round] of Object.entries(initialRounds)) {
        localDb.prepare('INSERT OR IGNORE INTO live_rounds(id, poll_id) VALUES (?, ?)').run(round, poll);
        localDb.prepare('INSERT OR IGNORE INTO live_events(id, active_round) VALUES (?, ?)').run(poll, round);
      }
      localDb.exec('CREATE TABLE IF NOT EXISTS live_migrations (id TEXT PRIMARY KEY)');
      const legacy = localDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('joy_event','joy_ballots')").all();
      if (legacy.length === 2 && !localDb.prepare("SELECT id FROM live_migrations WHERE id='poll-split-v2'").get()) {
        localDb.exec('BEGIN IMMEDIATE');
        try {
          const old = localDb.prepare("SELECT active_round, closed FROM joy_event WHERE id='main'").get();
          if (old) {
            const ballots = localDb.prepare('SELECT voter_hash, answers FROM joy_ballots WHERE round=?').all(old.active_round);
            for (const [poll, round] of Object.entries(initialRounds)) {
              for (const ballot of ballots) localDb.prepare('INSERT OR IGNORE INTO live_ballots(round, voter_hash, choices) VALUES (?,?,?)').run(round, ballot.voter_hash, JSON.stringify(JSON.parse(ballot.answers)[poll]));
              localDb.prepare('UPDATE live_events SET closed=? WHERE id=? AND active_round=?').run(Number(old.closed), poll, round);
            }
          }
          localDb.prepare("INSERT OR IGNORE INTO live_migrations(id) VALUES ('poll-split-v2')").run();
          localDb.exec('COMMIT');
        } catch (error) { localDb.exec('ROLLBACK'); throw error; }
      }
    }
  })();
  try { await ready; } catch (error) { ready = null; throw error; }
}
export async function snapshot(hash) {
  await initialize();
  if (sql) {
    const states = await sql.query(`SELECT e.id, e.active_round AS round, e.closed,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('choices', b.choices)) FROM live_ballots b WHERE b.round=e.active_round), '[]'::jsonb) AS ballots,
      (SELECT choices FROM live_ballots b WHERE b.round=e.active_round AND b.voter_hash=$1) AS own
      FROM live_events e`, [hash || '']);
    return { states, local: false };
  }
  localDb.exec('BEGIN');
  try {
    const states = localDb.prepare('SELECT id, active_round AS round, closed FROM live_events').all().map(event => {
      const ballots = localDb.prepare('SELECT choices FROM live_ballots WHERE round=?').all(event.round).map(row => ({ choices: JSON.parse(row.choices) }));
      const own = hash && localDb.prepare('SELECT choices FROM live_ballots WHERE round=? AND voter_hash=?').get(event.round, hash);
      return { ...event, closed: !!event.closed, ballots, own: own ? JSON.parse(own.choices) : null };
    });
    localDb.exec('COMMIT');
    return { states, local: true };
  } catch (error) { localDb.exec('ROLLBACK'); throw error; }
}
export async function submitBallot(poll, round, hash, choices) {
  await initialize();
  if (!findPoll(poll)) throw new VoteError('올바른 투표를 선택해주세요.');
  if (sql) {
    // Lock only this question. The other poll can keep accepting ballots.
    const rows = await sql.query(`WITH state AS (
      SELECT active_round, closed FROM live_events WHERE id=$1 FOR SHARE
    ), inserted AS (
      INSERT INTO live_ballots(round, voter_hash, choices)
      SELECT $2::uuid, $3, $4::jsonb FROM state WHERE active_round=$2::uuid AND NOT closed
      ON CONFLICT(round, voter_hash) DO NOTHING RETURNING voter_hash
    ) SELECT active_round AS round, closed, EXISTS(SELECT 1 FROM inserted) AS inserted FROM state`,
    [poll, round, hash, JSON.stringify(choices)]);
    if (!rows.length || rows[0].round !== round) throw new VoteError('이 QR의 투표 회차가 바뀌었습니다. 화면의 새 QR을 찍어주세요.', 409);
    const recorded = await sql.query('SELECT choices FROM live_ballots WHERE round=$1 AND voter_hash=$2', [round, hash]);
    if (!recorded.length) throw new VoteError('투표가 마감되었습니다.', 409);
    return { inserted: rows[0].inserted, choices: recorded[0].choices };
  }
  localDb.exec('BEGIN IMMEDIATE');
  try {
    const state = localDb.prepare('SELECT active_round AS round, closed FROM live_events WHERE id=?').get(poll);
    if (state.round !== round) throw new VoteError('이 QR의 투표 회차가 바뀌었습니다. 화면의 새 QR을 찍어주세요.', 409);
    const existing = localDb.prepare('SELECT choices FROM live_ballots WHERE round=? AND voter_hash=?').get(round, hash);
    if (!existing && state.closed) throw new VoteError('투표가 마감되었습니다.', 409);
    const result = existing ? { changes: 0 } : localDb.prepare('INSERT INTO live_ballots(round, voter_hash, choices) VALUES (?, ?, ?)').run(round, hash, JSON.stringify(choices));
    localDb.exec('COMMIT');
    return { inserted: !!result.changes, choices: existing ? JSON.parse(existing.choices) : choices };
  } catch (error) { localDb.exec('ROLLBACK'); throw error; }
}
export async function operate(action, poll, expectedRound) {
  await initialize();
  if (!findPoll(poll) || !['close', 'open', 'new-round'].includes(action)) throw new VoteError('지원하지 않는 작업입니다.');
  if (sql) {
    let result;
    if (action === 'new-round') {
      const id = randomUUID();
      // A stale operator action inserts no round and changes no question.
      result = await sql.query(`WITH target AS (
        SELECT id FROM live_events WHERE id=$1 AND active_round=$2 FOR UPDATE
      ), added AS (
        INSERT INTO live_rounds(id, poll_id) SELECT $3::uuid, id FROM target RETURNING id
      ) UPDATE live_events SET active_round=(SELECT id FROM added), closed=FALSE
        WHERE id=$1 AND EXISTS(SELECT 1 FROM added) RETURNING active_round`, [poll, expectedRound, id]);
    } else result = await sql.query('UPDATE live_events SET closed=$1 WHERE id=$2 AND active_round=$3 RETURNING active_round', [action === 'close', poll, expectedRound]);
    if (!result.length) throw new VoteError('투표 회차가 변경되었습니다. 새로고침해주세요.', 409);
  } else {
    localDb.exec('BEGIN IMMEDIATE');
    try {
      const state = localDb.prepare('SELECT active_round FROM live_events WHERE id=?').get(poll);
      if (state.active_round !== expectedRound) throw new VoteError('투표 회차가 변경되었습니다. 새로고침해주세요.', 409);
      if (action === 'new-round') {
        const id = randomUUID();
        localDb.prepare('INSERT INTO live_rounds(id, poll_id) VALUES (?, ?)').run(id, poll);
        localDb.prepare('UPDATE live_events SET active_round=?, closed=0 WHERE id=?').run(id, poll);
      } else localDb.prepare('UPDATE live_events SET closed=? WHERE id=?').run(Number(action === 'close'), poll);
      localDb.exec('COMMIT');
    } catch (error) { localDb.exec('ROLLBACK'); throw error; }
  }
}
