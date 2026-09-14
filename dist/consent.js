"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideConsent = decideConsent;
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
function decideConsent(consent, category, ctx = {}) {
    const status = consent?.status ?? 'unknown';
    if (status === 'opted_out') {
        return {
            allow: false,
            reason: 'opted_out',
            effectiveStatus: status,
            forceFooter: true,
        };
    }
    if (status === 'opted_in') {
        return { allow: true, effectiveStatus: status, forceFooter: false };
    }
    if (status === 'attested') {
        return { allow: true, effectiveStatus: status, forceFooter: true };
    }
    // unknown / absent
    if (category === 'reminder' && ctx.confirmedBookingExists !== true) {
        return {
            allow: false,
            reason: 'reminder_without_booking',
            effectiveStatus: status,
            forceFooter: true,
        };
    }
    return { allow: true, effectiveStatus: status, forceFooter: true };
}
//# sourceMappingURL=consent.js.map