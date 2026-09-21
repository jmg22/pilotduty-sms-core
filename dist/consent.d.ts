import type { Consent, ConsentStatus, SmsCategory } from './types';
export type ConsentRefusalReason = 'opted_out' | 'reminder_without_booking'
/** TOT-207 marks (P49 §5) — `evidence.invalid`, 21211 / 21614 / 21408. Never lifted. */
 | 'invalid'
/** `evidence.landline`, 30006. Never lifted. */
 | 'landline'
/** `evidence.unreachableSuspended`, three 30003 / 30005. Lifted by any inbound SMS or an admin retry. */
 | 'unreachable_suspended';
export interface ConsentDecision {
    allow: boolean;
    reason?: ConsentRefusalReason;
    /** The status the decision was taken on (`unknown` when no record). */
    effectiveStatus: ConsentStatus;
    /** STOP footer must be appended regardless of the first-contact window. */
    forceFooter: boolean;
}
export interface ConsentContext {
    /**
     * `unknown`/absent + `reminder` may only go out when a confirmed booking
     * exists for this number and organization (TOT-193). The caller knows —
     * the reminder cron has the booking in hand.
     */
    confirmedBookingExists?: boolean;
}
/**
 * Consent decision table — "Plan de vol SMS PilotDuty — référence" §3 and
 * TOT-193:
 *
 * | status            | category                  | decision                                  |
 * | opted_out         | all                       | refuse (opted_out)                        |
 * | opted_in          | all                       | send                                      |
 * | attested          | all                       | send, footer forced (status ≠ opted_in)   |
 * | unknown / absent  | transactional, safety     | send, footer forced                       |
 * | unknown / absent  | reminder                  | send, footer forced, ONLY with a confirmed booking |
 *
 * `attested` is never promoted to `opted_in` here — only a recipient action
 * does that (TOT-193).
 *
 * Delivery marks (TOT-207, P49 §5), checked right after `opted_out` and for
 * EVERY status and category — "never try again" is about the line, not about
 * consent: `evidence.invalid` → `invalid`, `evidence.landline` → `landline`,
 * `evidence.unreachableSuspended` → `unreachable_suspended`. Only the boolean
 * marks are read (written by `consentEvidencePatch`, the suspension lifted
 * with `unreachableLiftPatch`), never the raw counter.
 */
export declare function decideConsent(consent: (Pick<Consent, 'status'> & Partial<Pick<Consent, 'evidence'>>) | null | undefined, category: SmsCategory, ctx?: ConsentContext): ConsentDecision;
//# sourceMappingURL=consent.d.ts.map