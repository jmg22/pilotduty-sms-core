/**
 * TOT-209 — `reserveGlobalDailySlot` against the Firestore EMULATOR (real
 * transactions). Skipped unless FIRESTORE_EMULATOR_HOST is set:
 *
 *   npm run test:emulator
 *   (= firebase emulators:exec --only firestore --project demo-sms-core "vitest run test/emulator")
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { reserveGlobalDailySlot } from '../../src/global-cap';
import { RestFirestore } from './rest-db';

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sms-core';
const NOW = new Date('2026-09-21T16:15:00Z');
const DAY = '2026-09-21';
const PATH = `sms_counters/global_${DAY}`;

describe.skipIf(!HOST)('reserveGlobalDailySlot — Firestore emulator (TOT-209)', { timeout: 120_000 }, () => {
  const db = new RestFirestore(HOST ?? '', PROJECT);

  beforeEach(async () => {
    await db.clear();
    db.attempts = 0;
  });

  it('creates the UTC-labelled document and increments atomically', async () => {
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toEqual({ allowed: true, count: 1, cap: 3000, day: DAY });
    expect(await reserveGlobalDailySlot(db, { category: 'reminder', now: NOW, cap: 3000 })).toMatchObject({ allowed: true, count: 2 });
    expect(await db.read(PATH)).toEqual({ day: DAY, timezone: 'UTC', count: 2, cap: 3000, updatedAt: NOW });
  });

  it('limit: 2999 → 3000 (threshold cap), 3001st refused, counter untouched, marker kept', async () => {
    await db.seed(PATH, { day: DAY, count: 2999, thresholds: { warn: NOW } });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toEqual({ allowed: true, count: 3000, cap: 3000, day: DAY, threshold: 'cap' });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toEqual({ allowed: false, count: 3000, cap: 3000, day: DAY });
    const doc = await db.read(PATH);
    expect(doc).toMatchObject({ count: 3000, thresholds: { warn: NOW, cap: NOW } });
  });

  it('80 %: warn exactly once, merged without erasing the rest of the document', async () => {
    await db.seed(PATH, { day: DAY, count: 2399, foreign: 'kept' });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toMatchObject({ count: 2400, threshold: 'warn' });
    const next = await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 });
    expect(next).toEqual({ allowed: true, count: 2401, cap: 3000, day: DAY });
    expect(await db.read(PATH)).toMatchObject({ count: 2401, foreign: 'kept', thresholds: { warn: NOW } });
  });

  it('safety: counted beyond the cap, never refused; the others stay refused', async () => {
    await db.seed(PATH, { day: DAY, count: 3000, thresholds: { warn: NOW, cap: NOW } });
    expect(await reserveGlobalDailySlot(db, { category: 'safety', now: NOW, cap: 3000 })).toEqual({ allowed: true, count: 3001, cap: 3000, day: DAY });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })).toEqual({ allowed: false, count: 3001, cap: 3000, day: DAY });
    expect(await reserveGlobalDailySlot(db, { category: 'reminder', now: NOW, cap: 3000 })).toMatchObject({ allowed: false });
    expect((await db.read(PATH))?.count).toBe(3001);
  });

  it('UTC day change: 23:59:59.999Z is refused on the full day, 00:00:00.000Z opens a new document', async () => {
    await db.seed(PATH, { day: DAY, count: 3000, thresholds: { warn: NOW, cap: NOW } });
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: new Date('2026-09-21T23:59:59.999Z'), cap: 3000 })).toMatchObject({ allowed: false, day: DAY });
    // 20:00 in Toronto on the 21st — already the 22nd in UTC.
    const evening = new Date('2026-09-21T20:00:00-04:00');
    expect(await reserveGlobalDailySlot(db, { category: 'transactional', now: evening, cap: 3000 })).toEqual({ allowed: true, count: 1, cap: 3000, day: '2026-09-22' });
    expect(await db.read('sms_counters/global_2026-09-22')).toMatchObject({ day: '2026-09-22', timezone: 'UTC', count: 1 });
    expect((await db.read(PATH))?.count).toBe(3000);
  });

  it('concurrency: two simultaneous reservations at 2999 → a single passage to 3000', async () => {
    await db.seed(PATH, { day: DAY, count: 2999, thresholds: { warn: NOW } });
    const slots = await Promise.all([
      reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 }),
      reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 }),
    ]);
    expect(slots.filter((s) => s.allowed)).toHaveLength(1);
    expect(slots.filter((s) => s.threshold === 'cap')).toHaveLength(1);
    expect(slots.find((s) => !s.allowed)).toEqual({ allowed: false, count: 3000, cap: 3000, day: DAY });
    expect((await db.read(PATH))?.count).toBe(3000);
  });

  it('concurrency: 8 simultaneous reservations for 5 remaining slots, one threshold report', async () => {
    await db.seed(PATH, { day: DAY, count: 2995, thresholds: { warn: NOW } });
    const slots = await Promise.all(
      Array.from({ length: 8 }, () => reserveGlobalDailySlot(db, { category: 'reminder', now: NOW, cap: 3000 })),
    );
    expect(slots.filter((s) => s.allowed).map((s) => s.count).sort()).toEqual([2996, 2997, 2998, 2999, 3000]);
    expect(slots.filter((s) => s.threshold)).toHaveLength(1);
    expect((await db.read(PATH))?.count).toBe(3000);
  });

  it('concurrency from an empty day: 6 simultaneous first reservations are all counted', async () => {
    const slots = await Promise.all(
      Array.from({ length: 6 }, () => reserveGlobalDailySlot(db, { category: 'transactional', now: NOW, cap: 3000 })),
    );
    expect(slots.map((s) => s.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await db.read(PATH))?.count).toBe(6);
  });
});
