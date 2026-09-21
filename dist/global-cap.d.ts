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
export declare const DEFAULT_GLOBAL_DAILY_CAP = 3000;
/** Set by JMG (Vercel + Functions `.env`), never by an agent. */
export declare const GLOBAL_DAILY_CAP_ENV = "SMS_DAILY_CAP_GLOBAL";
/** Name read by sms-core ≤ v0.1.1 consumers (P21) — still honoured as a fallback. */
export declare const LEGACY_GLOBAL_DAILY_CAP_ENV = "SMS_GLOBAL_DAILY_CAP";
export declare const GLOBAL_COUNTER_COLLECTION = "sms_counters";
/** `warn` fires when the count reaches 80 % of the cap. */
export declare const GLOBAL_CAP_WARN_PERCENT = 80;
export type GlobalCapThreshold = 'warn' | 'cap';
export interface GlobalCounterSnapshotLike {
    exists: boolean;
    data(): Record<string, unknown> | undefined;
}
export interface GlobalCounterTransactionLike<Ref> {
    get(ref: Ref): Promise<GlobalCounterSnapshotLike>;
    set(ref: Ref, data: Record<string, unknown>, options: {
        merge: true;
    }): unknown;
}
/** Structural subset of `FirebaseFirestore.Firestore`. */
export interface GlobalCounterDbLike<Ref = unknown> {
    doc(path: string): Ref;
    runTransaction<T>(updateFunction: (tx: GlobalCounterTransactionLike<Ref>) => Promise<T>): Promise<T>;
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
export declare function utcDay(date: Date): string;
export declare function globalCounterDocPath(day: string): string;
/** `SMS_DAILY_CAP_GLOBAL`, else the legacy `SMS_GLOBAL_DAILY_CAP`, else 3000. Invalid values are ignored. */
export declare function resolveGlobalDailyCap(env?: Record<string, string | undefined>): number;
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
export declare function reserveGlobalDailySlot<Ref>(db: GlobalCounterDbLike<Ref>, input: ReserveGlobalDailySlotInput): Promise<GlobalDailySlot>;
//# sourceMappingURL=global-cap.d.ts.map