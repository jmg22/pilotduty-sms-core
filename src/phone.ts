import {
  parsePhoneNumberFromString,
  type CountryCode,
  type NumberType,
} from 'libphonenumber-js/max';

export type { CountryCode, NumberType };

/** Product-wide default: primary market is Canada (NANP). */
export const DEFAULT_PHONE_COUNTRY: CountryCode = 'CA';

export interface E164 {
  ok: true;
  /** Canonical `+<country><national>` form. */
  e164: string;
  country?: CountryCode;
  type?: NumberType;
}

export type InvalidPhoneReason =
  /** Empty or whitespace-only input. */
  | 'empty'
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
 * Line types that can receive an SMS. `undefined` (metadata cannot tell) is
 * accepted as long as the number is valid — better to let Twilio decide than
 * to reject a legitimate recipient in a country with thin metadata.
 */
const SMS_CAPABLE_TYPES: ReadonlySet<NumberType | undefined> = new Set<
  NumberType | undefined
>(['MOBILE', 'FIXED_LINE_OR_MOBILE', undefined]);

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
export function normalizePhone(
  raw: string,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): E164 | InvalidPhone {
  const input = typeof raw === 'string' ? raw.trim() : '';
  if (!input) return { ok: false, reason: 'empty', raw: input };

  let parsed;
  try {
    parsed = parsePhoneNumberFromString(input, defaultCountry);
  } catch {
    parsed = undefined;
  }
  if (!parsed) return { ok: false, reason: 'unparseable', raw: input };

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
export function isSmsCapablePhone(
  raw: string,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): boolean {
  return normalizePhone(raw, defaultCountry).ok;
}

/** Convenience: E.164 string or `null`. */
export function toE164(
  raw: string,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): string | null {
  const result = normalizePhone(raw, defaultCountry);
  return result.ok ? result.e164 : null;
}
