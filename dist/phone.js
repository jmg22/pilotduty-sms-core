"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PHONE_COUNTRY = void 0;
exports.normalizePhone = normalizePhone;
exports.isSmsCapablePhone = isSmsCapablePhone;
exports.toE164 = toE164;
const max_1 = require("libphonenumber-js/max");
/** Product-wide default: primary market is Canada (NANP). */
exports.DEFAULT_PHONE_COUNTRY = 'CA';
/**
 * Line types that can receive an SMS. `undefined` (metadata cannot tell) is
 * accepted as long as the number is valid — better to let Twilio decide than
 * to reject a legitimate recipient in a country with thin metadata.
 */
const SMS_CAPABLE_TYPES = new Set(['MOBILE', 'FIXED_LINE_OR_MOBILE', undefined]);
/**
 * Normalize a user-entered phone number to E.164, rejecting anything that is
 * not a valid, SMS-capable number for its own country.
 *
 * - A number with `+` carries its own country; `defaultCountry` is ignored.
 * - A national-format number is interpreted in `defaultCountry` (CA by
 *   default): `5142905402` → `+15142905402`.
 * - The result is `ok: false` with a machine-readable `reason` otherwise.
 *
 * Never throws.
 */
function normalizePhone(raw, defaultCountry = exports.DEFAULT_PHONE_COUNTRY) {
    const input = typeof raw === 'string' ? raw.trim() : '';
    if (!input)
        return { ok: false, reason: 'empty', raw: input };
    let parsed;
    try {
        parsed = (0, max_1.parsePhoneNumberFromString)(input, defaultCountry);
    }
    catch {
        parsed = undefined;
    }
    if (!parsed)
        return { ok: false, reason: 'unparseable', raw: input };
    const country = parsed.country;
    if (!parsed.isValid()) {
        return { ok: false, reason: 'invalid_for_country', raw: input, country };
    }
    const type = parsed.getType();
    if (!SMS_CAPABLE_TYPES.has(type)) {
        return { ok: false, reason: 'not_mobile', raw: input, country, type };
    }
    return { ok: true, e164: parsed.number, country, type };
}
/** Convenience: `true` when `normalizePhone` accepts the input. */
function isSmsCapablePhone(raw, defaultCountry = exports.DEFAULT_PHONE_COUNTRY) {
    return normalizePhone(raw, defaultCountry).ok;
}
/** Convenience: E.164 string or `null`. */
function toE164(raw, defaultCountry = exports.DEFAULT_PHONE_COUNTRY) {
    const result = normalizePhone(raw, defaultCountry);
    return result.ok ? result.e164 : null;
}
//# sourceMappingURL=phone.js.map