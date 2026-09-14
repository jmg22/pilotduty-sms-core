/**
 * Twilio error classification — "Plan de vol SMS PilotDuty — référence" §7
 * and TOT-207. The gateway always records `code` and `moreInfo`; consumers
 * branch on `class` (Sentry `fatal` on `unregistered_sender`, etc.).
 */

export type TwilioErrorClass =
  /** 30034 — sender not registered for A2P. Must never happen after 6b. */
  | 'unregistered_sender'
  /** 21610 — recipient unsubscribed at Twilio. Retroactive opt-out. */
  | 'opted_out'
  /** 30003 / 30005 — unreachable / unknown destination. */
  | 'unreachable'
  /** 30007 — filtered by the carrier. Reputation signal. */
  | 'carrier_filtered'
  /** 30006 — landline. Never retry. */
  | 'landline'
  /** 21211 / 21614 / 21408 — invalid number or region not enabled (TOT-275). */
  | 'invalid_number'
  | 'other';

export function classifyTwilioError(code: number | undefined): TwilioErrorClass {
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
export function isPermanentTwilioError(errorClass: TwilioErrorClass): boolean {
  return (
    errorClass === 'opted_out' ||
    errorClass === 'landline' ||
    errorClass === 'invalid_number' ||
    errorClass === 'unregistered_sender'
  );
}

export interface TwilioErrorInfo {
  code?: number;
  status?: number;
  message: string;
  moreInfo?: string;
  class: TwilioErrorClass;
}

/** Extract what matters from whatever `messages.create()` rejected with. */
export function describeTwilioError(err: unknown): TwilioErrorInfo {
  const anyErr = (err ?? {}) as Record<string, unknown>;
  const rawCode = anyErr.code;
  const code =
    typeof rawCode === 'number'
      ? rawCode
      : typeof rawCode === 'string' && /^\d+$/.test(rawCode)
        ? Number(rawCode)
        : undefined;
  const status = typeof anyErr.status === 'number' ? anyErr.status : undefined;
  const moreInfo =
    typeof anyErr.moreInfo === 'string' ? anyErr.moreInfo : undefined;
  const message =
    typeof anyErr.message === 'string'
      ? anyErr.message
      : err instanceof Error
        ? err.message
        : String(err);
  return { code, status, message, moreInfo, class: classifyTwilioError(code) };
}
