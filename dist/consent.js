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
 *
 * Delivery marks (TOT-207, P49 §5, P50 §0), checked right after `opted_out` —
 * "never try again" is about the line, not about consent:
 *
 * | mark                            | refuses                                  |
 * | `evidence.invalid`              | every status AND every category, `safety` included |
 * | `evidence.landline`             | every status AND every category, `safety` included |
 * | `evidence.unreachableSuspended` | every status, EXCEPT `category === 'safety'` (P50 §0) |
 *
 * Only the boolean marks are read (written by `consentEvidencePatch`, the
 * suspension lifted with `unreachableLiftPatch`), never the raw counter.
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
    const marks = consent?.evidence;
    const marked = marks?.invalid === true
        ? 'invalid'
        : marks?.landline === true
            ? 'landline'
            : marks?.unreachableSuspended === true
                ? 'unreachable_suspended'
                : undefined;
    // P50 §0 — `safety` passe outre `unreachable_suspended` : un téléphone éteint
    // trois fois n'est pas un numéro invalide, et c'est exactement le cas où
    // l'alerte de retard doit partir (même exemption que pour le plafond global).
    // `invalid` et `landline` bloquent TOUTES les catégories, `safety` comprise :
    // la ligne ne peut physiquement pas recevoir — un envoi n'y serait pas une
    // sécurité mais une illusion de sécurité.
    if (marked && !(marked === 'unreachable_suspended' && category === 'safety')) {
        return { allow: false, reason: marked, effectiveStatus: status, forceFooter: true };
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