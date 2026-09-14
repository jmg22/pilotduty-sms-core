"use strict";
/**
 * Twilio error classification — "Plan de vol SMS PilotDuty — référence" §7
 * and TOT-207. The gateway always records `code` and `moreInfo`; consumers
 * branch on `class` (Sentry `fatal` on `unregistered_sender`, etc.).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyTwilioError = classifyTwilioError;
exports.isPermanentTwilioError = isPermanentTwilioError;
exports.describeTwilioError = describeTwilioError;
function classifyTwilioError(code) {
    switch (code) {
        case 30034:
            return 'unregistered_sender';
        case 21610:
            return 'opted_out';
        case 30003:
        case 30005:
            return 'unreachable';
        case 30007:
            return 'carrier_filtered';
        case 30006:
            return 'landline';
        case 21211:
        case 21614:
        case 21408:
            return 'invalid_number';
        default:
            return 'other';
    }
}
/** Classes for which a retry can never succeed (same number, same content). */
function isPermanentTwilioError(errorClass) {
    return (errorClass === 'opted_out' ||
        errorClass === 'landline' ||
        errorClass === 'invalid_number' ||
        errorClass === 'unregistered_sender');
}
/** Extract what matters from whatever `messages.create()` rejected with. */
function describeTwilioError(err) {
    const anyErr = (err ?? {});
    const rawCode = anyErr.code;
    const code = typeof rawCode === 'number'
        ? rawCode
        : typeof rawCode === 'string' && /^\d+$/.test(rawCode)
            ? Number(rawCode)
            : undefined;
    const status = typeof anyErr.status === 'number' ? anyErr.status : undefined;
    const moreInfo = typeof anyErr.moreInfo === 'string' ? anyErr.moreInfo : undefined;
    const message = typeof anyErr.message === 'string'
        ? anyErr.message
        : err instanceof Error
            ? err.message
            : String(err);
    return { code, status, message, moreInfo, class: classifyTwilioError(code) };
}
//# sourceMappingURL=errors.js.map