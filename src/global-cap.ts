import type { SmsCategory } from './types';

/**
 * Global daily cap — TOT-209, decisions P11 / P21 / P48.
 *
 * One counter for the whole platform, `sms_counters/global_{YYYY-MM-DD}`,
 * on the **UTC** calendar day (labelled as such in the document), shared by
 * the webapp, the Functions fan-out and the iOS relay. `reserveGlobalDailySlot`
 * is called AFTER the consent checks and the per-organization monthly cap and
 * BEFORE `messages.create()`: a reservation that Twilio then rejects still
 * consumes one unit (economic guard, not a security gate).
 *
 * Nothing from Firebase is imported: `db` is structural, the real
 * `firebase-admin` Firestore satisfies it as is.
 */

export const DEFAULT_GLOBAL_DAILY_CAP = 3000;
/** Set by JMG (Vercel + Functions `.env`), never by an agent. */
export const GLOBAL_DAILY_CAP_ENV = 'SMS_DAILY_CAP_GLOBAL';
/** Name read by sms-core ≤ v0.1.1 consumers (P21) — still honoured as a fallback. */
export const LEGACY_GLOBAL_DAILY_CAP_ENV = 'SMS_GLOBAL_DAILY_CAP';
export const GLOBAL_COUNTER_COLLECTION = 'sms_counters';
/** `warn` fires when the count reaches 80 % of the cap. */
export const GLOBAL_CAP_WARN_PERCENT = 80;

export type GlobalCapThreshold = 'warn' | 'cap';

export interface GlobalCounterSnapshotLike {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface GlobalCounterTransactionLike<Ref> {
  get(ref: Ref): Promise<GlobalCounterSnapshotLike>;
  set(ref: Ref, data: Record<string, unknown>, options: { merge: true }): unknown;
}

/** Structural subset of `FirebaseFirestore.Firestore`. */
export interface GlobalCounterDbLike<Ref = unknown> {
  doc(path: string): Ref;
  runTransaction<T>(
    updateFunction: (tx: GlobalCounterTransactionLike<Ref>) => Promise<T>,
  ): Promise<T>;
}

export interface ReserveGlobalDailySlotInput {
  category: SmsCategory;
  /** Defaults to the current time. The UTC day of `now` names the counter. */
  now?: Date;
  /** Overrides the environment (tests, callers with their own configuration). */
  cap?: number;
}

export interface GlobalDailySlot {
  /** `false` = the caller records `suppressed`, `reason = global_cap` and does not call Twilio. */
  allowed: boolean;
  /** Count for the day AFTER this call (unchanged when refused). */
  count: number;
  cap: number;
  /** UTC day of the counter, `YYYY-MM-DD`. */
  day: string;
  /**
   * Present on the ONE call of the day that crosses the threshold (marker in
   * the counter document): the caller reports `warn` to Sentry as `warning`
   * and `cap` as `error`.
   */
  threshold?: GlobalCapThreshold;
}

export function utcDay(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('[sms-core] reserveGlobalDailySlot: `now` must be a valid Date');
  }
  return date.toISOString().slice(0, 10);
}

export function globalCounterDocPath(day: string): string {
  return `${GLOBAL_COUNTER_COLLECTION}/global_${day}`;
}

function parseCap(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : undefined;
  }
  if (typeof raw === 'string' && /^\d{1,9}$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return n > 0 ? n : undefined;
  }
  return undefined;
}

/** `SMS_DAILY_CAP_GLOBAL`, else the legacy `SMS_GLOBAL_DAILY_CAP`, else 3000. Invalid values are ignored. */
export function resolveGlobalDailyCap(
  env: Record<string, string | undefined> = typeof process !== 'undefined'
    ? process.env
    : {},
): number {
  return (
    parseCap(env[GLOBAL_DAILY_CAP_ENV]) ??
    parseCap(env[LEGACY_GLOBAL_DAILY_CAP_ENV]) ??
    DEFAULT_GLOBAL_DAILY_CAP
  );
}

function reachesWarn(count: number, cap: number): boolean {
  return count * 100 >= cap * GLOBAL_CAP_WARN_PERCENT;
}

/**
 * Atomically reserve one unit of the platform-wide daily quota.
 *
 * - `category !== 'safety'` and the day is already at the cap → refused, the
 *   counter is left untouched.
 * - `safety` is always allowed AND counted (the count may exceed the cap).
 * - `threshold` is returned once per day and per threshold: the marker is
 *   written in the same transaction as the increment, so two concurrent
 *   reservations never both report it. Crossing both at once (tiny cap)
 *   reports `cap` only. A refusal on a day whose `cap` marker is missing
 *   (cap lowered during the day) reports `cap` and writes the marker.
 */
export async function reserveGlobalDailySlot<Ref>(
  db: GlobalCounterDbLike<Ref>,
  input: ReserveGlobalDailySlotInput,
): Promise<GlobalDailySlot> {
  const now = input.now ?? new Date();
  const day = utcDay(now);
  const cap = parseCap(input.cap) ?? resolveGlobalDailyCap();
  const ref = db.doc(globalCounterDocPath(day));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = (snap.exists ? snap.data() : undefined) ?? {};
    const stored = Number(data.count);
    const count = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
    const markers = (data.thresholds ?? {}) as Record<string, unknown>;
    const warnMarked = markers.warn != null;
    const capMarked = markers.cap != null;

    if (input.category !== 'safety' && count >= cap) {
      if (capMarked) return { allowed: false, count, cap, day };
      tx.set(
        ref,
        { day, timezone: 'UTC', cap, thresholds: { warn: markers.warn ?? now, cap: now }, updatedAt: now },
        { merge: true },
      );
      return { allowed: false, count, cap, day, threshold: 'cap' as const };
    }

    const next = count + 1;
    let threshold: GlobalCapThreshold | undefined;
    if (next >= cap && !capMarked) threshold = 'cap';
    else if (reachesWarn(next, cap) && !warnMarked && !capMarked) threshold = 'warn';

    tx.set(
      ref,
      {
        day,
        timezone: 'UTC',
        count: next,
        cap,
        updatedAt: now,
        ...(threshold === 'cap'
          ? { thresholds: { warn: markers.warn ?? now, cap: now } }
          : threshold === 'warn'
            ? { thresholds: { warn: now } }
            : {}),
      },
      { merge: true },
    );
    return { allowed: true, count: next, cap, day, ...(threshold ? { threshold } : {}) };
  });
}
