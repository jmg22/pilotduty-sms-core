"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLOBAL_CAP_WARN_PERCENT = exports.GLOBAL_COUNTER_COLLECTION = exports.GLOBAL_DAILY_CAP_ENV = exports.DEFAULT_GLOBAL_DAILY_CAP = void 0;
exports.utcDay = utcDay;
exports.globalCounterDocPath = globalCounterDocPath;
exports.resolveGlobalDailyCap = resolveGlobalDailyCap;
exports.reserveGlobalDailySlot = reserveGlobalDailySlot;
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
exports.DEFAULT_GLOBAL_DAILY_CAP = 3000;
/**
 * The one canonical name (P21, P49) — the same variable the webapp and
 * Functions already read. Set by JMG (Vercel + Functions `.env`), never by an agent.
 */
exports.GLOBAL_DAILY_CAP_ENV = 'SMS_GLOBAL_DAILY_CAP';
exports.GLOBAL_COUNTER_COLLECTION = 'sms_counters';
/** `warn` fires when the count reaches 80 % of the cap. */
exports.GLOBAL_CAP_WARN_PERCENT = 80;
function utcDay(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new TypeError('[sms-core] reserveGlobalDailySlot: `now` must be a valid Date');
    }
    return date.toISOString().slice(0, 10);
}
function globalCounterDocPath(day) {
    return `${exports.GLOBAL_COUNTER_COLLECTION}/global_${day}`;
}
function parseCap(raw) {
    if (typeof raw === 'number') {
        return Number.isInteger(raw) && raw > 0 ? raw : undefined;
    }
    if (typeof raw === 'string' && /^\d{1,9}$/.test(raw.trim())) {
        const n = Number(raw.trim());
        return n > 0 ? n : undefined;
    }
    return undefined;
}
/** `SMS_GLOBAL_DAILY_CAP`, else 3000. An invalid value is ignored. */
function resolveGlobalDailyCap(env = typeof process !== 'undefined'
    ? process.env
    : {}) {
    return parseCap(env[exports.GLOBAL_DAILY_CAP_ENV]) ?? exports.DEFAULT_GLOBAL_DAILY_CAP;
}
function reachesWarn(count, cap) {
    return count * 100 >= cap * exports.GLOBAL_CAP_WARN_PERCENT;
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
async function reserveGlobalDailySlot(db, input) {
    const now = input.now ?? new Date();
    const day = utcDay(now);
    const cap = parseCap(input.cap) ?? resolveGlobalDailyCap();
    const ref = db.doc(globalCounterDocPath(day));
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = (snap.exists ? snap.data() : undefined) ?? {};
        const stored = Number(data.count);
        const count = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 0;
        const markers = (data.thresholds ?? {});
        const warnMarked = markers.warn != null;
        const capMarked = markers.cap != null;
        if (input.category !== 'safety' && count >= cap) {
            if (capMarked)
                return { allowed: false, count, cap, day };
            tx.set(ref, { day, timezone: 'UTC', cap, thresholds: { warn: markers.warn ?? now, cap: now }, updatedAt: now }, { merge: true });
            return { allowed: false, count, cap, day, threshold: 'cap' };
        }
        const next = count + 1;
        let threshold;
        if (next >= cap && !capMarked)
            threshold = 'cap';
        else if (reachesWarn(next, cap) && !warnMarked && !capMarked)
            threshold = 'warn';
        tx.set(ref, {
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
        }, { merge: true });
        return { allowed: true, count: next, cap, day, ...(threshold ? { threshold } : {}) };
    });
}
//# sourceMappingURL=global-cap.js.map