import { type CountryCode, type NumberType } from 'libphonenumber-js/max';
export type { CountryCode, NumberType };
/** Product-wide default: primary market is Canada (NANP). */
export declare const DEFAULT_PHONE_COUNTRY: CountryCode;
export interface E164 {
    ok: true;
    /** Canonical `+<country><national>` form. */
    e164: string;
    country?: CountryCode;
    type?: NumberType;
}
export type InvalidPhoneReason = 
/** Empty or whitespace-only input. */
'empty'
/** Nothing that looks like a phone number (TOT-195: `" 1"`). */
 | 'unparseable'
/** Parsed, but not a valid number for the country it claims. */
 | 'invalid_for_country'
/**
 * Valid, but the line type cannot receive SMS (fixed line, toll-free,
 * premium…). TOT-275: `+5142905402` is a VALID Peruvian landline — this
 * is the rule that rejects it, not validity.
 */
 | 'not_mobile';
export interface InvalidPhone {
    ok: false;
    reason: InvalidPhoneReason;
    raw: string;
    country?: CountryCode;
    type?: NumberType;
}
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
export declare function normalizePhone(raw: string, defaultCountry?: CountryCode): E164 | InvalidPhone;
/** Convenience: `true` when `normalizePhone` accepts the input. */
export declare function isSmsCapablePhone(raw: string, defaultCountry?: CountryCode): boolean;
/** Convenience: E.164 string or `null`. */
export declare function toE164(raw: string, defaultCountry?: CountryCode): string | null;
//# sourceMappingURL=phone.d.ts.map