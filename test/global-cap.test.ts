import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GLOBAL_DAILY_CAP,
  GLOBAL_DAILY_CAP_ENV,
  globalCounterDocPath,
  reserveGlobalDailySlot,
  resolveGlobalDailyCap,
  utcDay,
} from '../src/global-cap';
import { MemoryDb } from './memory-db';

const NOW = new Date('2026-09-21T16:15:00Z');
const DAY = '2026-09-21';
const PATH = `sms_counters/global_${DAY}`;

function dbAt(count: number, extra: Record<string, unknown> = {}): MemoryDb {
  const db = new MemoryDb();
  db.docs.set(PATH, { day: DAY, count, ...extra });
  return db;
}

describe('reserveGlobalDailySlot — TOT-209 (in-memory transactions)', () => {
  it('names the counter after the UTC day', () => {
    expect(globalCounterDocPath(utcDay(NOW))).toBe(PATH);
    expect(utcDay(new Date('2026-09-21T23:59:59.999Z'))).toBe('2026-09-21');
    expect(utcDay(new Date('2026-09-22T00:00:00.000Z'))).toBe('2026-09-22');
    // 20:30 in Toronto on the 21st is already the 22nd in UTC.
    expect(utcDay(new Date('2026-09-21T20:30:00-04:00'))).toBe('2026-09-22');
    expect(() => utcDay(new Date('nope'))).toThrow(TypeError);
  });

  it('first reservation of the day creates the document, labelled UTC', async () => {
    const db = new MemoryDb();
    const slot = await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 });
    expect(slot).toEqual({ allowed: true, count: 1, cap: 3000, day: DAY });
    expect(db.docs.get(PATH)).toEqual({ day: DAY, timezone: 'UTC', count: 1, cap: 3000, updatedAt: NOW });
  });

  it('keeps counting on a document written by a v0.1 store ({ day, count, updatedAt })', async () => {
    const db = dbAt(41, { updatedAt: new Date('2026-09-21T10:00:00Z') });
    expect(await reserveGlobalDailySlot(db, { category: 'reminder', now: NOW, cap: 3000 })).toMatchObject({ allowed: true, count: 42 });
  });

  it('at the limit: 2999 → 3000 allowed with threshold cap, the next one refused without touching the counter', async () => {
    const db = dbAt(2999, { thresholds: { warn: new Date('2026-09-21T12:00:00Z') } });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toEqual({
      allowed: true, count: 3000, cap: 3000, day: DAY, threshold: 'cap',
    });
    const commits = db.commits;
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toEqual({
      allowed: false, count: 3000, cap: 3000, day: DAY,
    });
    expect(await reserveGlobalDailySlot(db, { category: 'reminder', now: NOW, cap: 3000 })).toMatchObject({ allowed: false, count: 3000 });
    expect(db.commits).toBe(commits);
    expect(db.docs.get(PATH)?.count).toBe(3000);
  });

  it('safety is counted but never refused, and does not re-emit the threshold', async () => {
    const db = dbAt(3000, { thresholds: { warn: NOW, cap: NOW } });
    expect(await reserveGlobalDailySlot(db, { category: 'safety', now: NOW, cap: 3000 })).toEqual({ allowed: true, count: 3001, cap: 3000, day: DAY });
    expect(await reserveGlobalDailySlot(db, { category: 'safety', now: NOW, cap: 3000 })).toMatchObject({ allowed: true, count: 3002 });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toMatchObject({ allowed: false, count: 3002 });
  });

  it('a safety message is the one that reaches the cap → it reports cap', async () => {
    const db = dbAt(2999, { thresholds: { warn: NOW } });
    expect(await reserveGlobalDailySlot(db, { category: 'safety', now: NOW, cap: 3000 })).toMatchObject({ allowed: true, count: 3000, threshold: 'cap' });
  });

  it('warn at 80 % exactly, once', async () => {
    const db = dbAt(2398);
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toEqual({ allowed: true, count: 2399, cap: 3000, day: DAY });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toEqual({
      allowed: true, count: 2400, cap: 3000, day: DAY, threshold: 'warn',
    });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toEqual({ allowed: true, count: 2401, cap: 3000, day: DAY });
    expect((db.docs.get(PATH)?.thresholds as Record<string, unknown>).warn).toEqual(NOW);
    expect((db.docs.get(PATH)?.thresholds as Record<string, unknown>).cap).toBeUndefined();
  });

  it('a whole day emits exactly one warn and one cap', async () => {
    const db = new MemoryDb();
    const seen: string[] = [];
    for (let i = 0; i < 14; i += 1) {
      const slot = await reserveGlobalDailySlot(db, { category: i % 2 ? 'safety' : 'transactional', now: NOW, cap: 10 });
      if (slot.threshold) seen.push(`${slot.threshold}@${slot.count}`);
    }
    expect(seen).toEqual(['warn@8', 'cap@10']);
  });

  it('crossing both thresholds at once (cap = 1) reports cap only', async () => {
    const db = new MemoryDb();
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 1 })).toMatchObject({ allowed: true, count: 1, threshold: 'cap' });
    const thresholds = db.docs.get(PATH)?.thresholds as Record<string, unknown>;
    expect(thresholds.warn).toEqual(NOW);
    expect(thresholds.cap).toEqual(NOW);
  });

  it('cap lowered during the day: the first refusal reports cap and writes the marker, once', async () => {
    const db = dbAt(500);
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 400 })).toEqual({
      allowed: false, count: 500, cap: 400, day: DAY, threshold: 'cap',
    });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 400 })).toEqual({ allowed: false, count: 500, cap: 400, day: DAY });
    expect(db.docs.get(PATH)?.count).toBe(500);
  });

  it('UTC day change: a new document, a fresh quota and fresh markers', async () => {
    const db = dbAt(3000, { thresholds: { warn: NOW, cap: NOW } });
    const before = new Date('2026-09-21T23:59:59.999Z');
    const after = new Date('2026-09-22T00:00:00.000Z');
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: before, cap: 3000 })).toMatchObject({ allowed: false, day: '2026-09-21' });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: after, cap: 3000 })).toEqual({ allowed: true, count: 1, cap: 3000, day: '2026-09-22' });
    expect(db.docs.get('sms_counters/global_2026-09-22')).toMatchObject({ day: '2026-09-22', timezone: 'UTC', count: 1 });
    expect(db.docs.get(PATH)?.count).toBe(3000);
  });

  it('concurrency: two simultaneous reservations at 2999 → one passage to 3000, one cap report', async () => {
    const db = dbAt(2999, { thresholds: { warn: NOW } });
    const slots = await Promise.all([
      reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 }),
      reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 }),
    ]);
    expect(slots.filter((s) => s.allowed)).toHaveLength(1);
    expect(slots.filter((s) => s.threshold === 'cap')).toHaveLength(1);
    expect(slots.find((s) => s.allowed)).toMatchObject({ count: 3000, threshold: 'cap' });
    expect(slots.find((s) => !s.allowed)).toEqual({ allowed: false, count: 3000, cap: 3000, day: DAY });
    expect(db.docs.get(PATH)?.count).toBe(3000);
    expect(db.attempts).toBeGreaterThan(2); // the loser was really re-run
  });

  it('concurrency: 25 simultaneous reservations for 10 remaining slots', async () => {
    const db = dbAt(2990, { thresholds: { warn: NOW } });
    const slots = await Promise.all(
      Array.from({ length: 25 }, () => reserveGlobalDailySlot(db, { category: 'reminder', now: NOW, cap: 3000 })),
    );
    expect(slots.filter((s) => s.allowed)).toHaveLength(10);
    expect(slots.filter((s) => s.threshold)).toHaveLength(1);
    expect(slots.filter((s) => s.allowed).map((s) => s.count).sort()).toEqual([2991, 2992, 2993, 2994, 2995, 2996, 2997, 2998, 2999, 3000]);
    expect(db.docs.get(PATH)?.count).toBe(3000);
  });

  it('survives a corrupted count', async () => {
    const db = dbAt(0, { count: 'abc' });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 5 })).toMatchObject({ allowed: true, count: 1 });
  });

  it('defaults now to the current time', async () => {
    const db = new MemoryDb();
    const slot = await reserveGlobalDailySlot(db, { category: 'transactional', cap: 5 });
    expect(slot.day).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('resolveGlobalDailyCap', () => {
  it('SMS_GLOBAL_DAILY_CAP (the one canonical name, P21 / P49), then 3000', () => {
    expect(DEFAULT_GLOBAL_DAILY_CAP).toBe(3000);
    expect(GLOBAL_DAILY_CAP_ENV).toBe('SMS_GLOBAL_DAILY_CAP');
    expect(resolveGlobalDailyCap({})).toBe(3000);
    expect(resolveGlobalDailyCap({ SMS_GLOBAL_DAILY_CAP: '1200' })).toBe(1200);
  });

  it('no alias: SMS_DAILY_CAP_GLOBAL is never read', () => {
    expect(resolveGlobalDailyCap({ SMS_DAILY_CAP_GLOBAL: '5000' })).toBe(3000);
    expect(resolveGlobalDailyCap({ SMS_DAILY_CAP_GLOBAL: '5000', SMS_GLOBAL_DAILY_CAP: '1200' })).toBe(1200);
  });

  it.each(['', 'abc', '0', '-5', '12.5', '1e3', ' '])('ignores the invalid value %j', (raw) => {
    expect(resolveGlobalDailyCap({ SMS_GLOBAL_DAILY_CAP: raw })).toBe(3000);
  });

  it('reads process.env by default, and an explicit cap wins', async () => {
    const previous = process.env.SMS_GLOBAL_DAILY_CAP;
    process.env.SMS_GLOBAL_DAILY_CAP = '2';
    try {
      const db = new MemoryDb();
      expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW })).toMatchObject({ cap: 2, count: 1 });
      expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 50 })).toMatchObject({ cap: 50, count: 2 });
      expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW })).toMatchObject({ allowed: false, cap: 2 });
    } finally {
      if (previous === undefined) delete process.env.SMS_GLOBAL_DAILY_CAP;
      else process.env.SMS_GLOBAL_DAILY_CAP = previous;
    }
  });
});
