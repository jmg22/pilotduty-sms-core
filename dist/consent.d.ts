import type { Consent, ConsentStatus, SmsCategory } from './types';
export type ConsentRefusalReason = 'opted_out' | 'reminder_without_booking';
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
 */
export declare function decideConsent(consent: Pick<Consent, 'status'> | null | undefined, category: SmsCategory, ctx?: ConsentContext): ConsentDecision;
//# sourceMappingURL=consent.d.ts.map