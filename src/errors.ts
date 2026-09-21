/**
 * Twilio error classification — "Plan de vol SMS PilotDuty — référence" §7,
 * TOT-207 and decision P48: the table lives HERE, one truth for the webapp
 * (send path + status callback) and Functions (iOS relay + fan-out).
 *
 * | code                  | action                  | effect at the caller                                   |
 * | 30034                 | alert_fatal             | Sentry `fatal`, immediately                            |
 * | 21610                 | opt_out_retroactive     | create `sms_opt_outs/{e164}` (`source: twilio_21610`)  |
 * | 30003 / 30005         | unreachable_increment   | `evidence.unreachableCount++`, suspended at 3          |
 * | 30007                 | carrier_filtered        | reputation counter; alert above 2 % over 24 h          |
 * | 30006                 | mark_landline           | `evidence.landline = true`, never try again            |
 * | 21211 / 21614 / 21408 | mark_invalid            | `evidence.invalid = true`, never try again (TOT-275)   |
 * | anything else         | log_only                | log `code` + `moreInfo`                                |
 *
 * `retry` is `false` for every row: no integration ever retries a Twilio
 * refusal (TOT-169 §7, TOT-183 — a retry loop is an SMS storm).
 */

export type TwilioErrorAction =
  | 'alert_fatal'
  | 'opt_out_retroactive'
  | 'unreachable_increment'
  | 'carrier_filtered'
  | 'mark_landline'
  | 'mark_invalid'
  | 'log_only';

/** Sentry levels — the caller reports with this level as is. */
export type TwilioErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

export interface TwilioErrorClassification {
  action: TwilioErrorAction;
  severity: TwilioErrorSeverity;
  /** Always `false` — see the header. */
  retry: false;
}

/** The TOT-207 table, code by code. Anything absent is `log_only`. */
export const TWILIO_ERROR_ACTIONS: Readonly<Record<number, TwilioErrorAction>> =
  Object.freeze({
    30034: 'alert_fatal',
    21610: 'opt_out_retroactive',
    30003: 'unreachable_increment',
    30005: 'unreachable_increment',
    30007: 'carrier_filtered',
    30006: 'mark_landline',
    21211: 'mark_invalid',
    21614: 'mark_invalid',
    21408: 'mark_invalid',
  });

/**
 * - `fatal`: must never happen once the campaign is registered (6b).
 * - `info`: the recipient's own choice, handled automatically.
 * - `warning`: a send was lost; the per-number effect is applied by the caller
 *   (the 2 % alert on 30007 is computed by the status callback, not here).
 */
export const TWILIO_ERROR_SEVERITIES: Readonly<
  Record<TwilioErrorAction, TwilioErrorSeverity>
> = Object.freeze({
  alert_fatal: 'fatal',
  opt_out_retroactive: 'info',
  unreachable_increment: 'warning',
  carrier_filtered: 'warning',
  mark_landline: 'warning',
  mark_invalid: 'warning',
  log_only: 'warning',
});

/** 30003 / 30005: the number is suspended once `unreachableCount` reaches this. */
export const UNREACHABLE_SUSPEND_AFTER = 3;

/**
 * Twilio hands the code over as a number (`RestException.code`) or as a
 * string (`ErrorCode` form field of the status callback). Anything that is
 * not a plain positive integer is "no code".
 */
export function parseTwilioErrorCode(code: unknown): number | undefined {
  if (typeof code === 'number') {
    return Number.isInteger(code) && code > 0 ? code : undefined;
  }
  if (typeof code === 'string' && /^\d{1,9}$/.test(code.trim())) {
    const n = Number(code.trim());
    return n > 0 ? n : undefined;
  }
  return undefined;
}

/**
 * TOT-207 — what to do with a Twilio error code, whether it comes from the
 * API error of `messages.create()` or from the `ErrorCode` of the status
 * callback. Unknown, missing and non-numeric codes are `log_only`.
 */
export function classifyTwilioError(code: unknown): TwilioErrorClassification {
  const parsed = parseTwilioErrorCode(code);
  const action: TwilioErrorAction =
    (parsed !== undefined ? TWILIO_ERROR_ACTIONS[parsed] : undefined) ?? 'log_only';
  return { action, severity: TWILIO_ERROR_SEVERITIES[action], retry: false };
}

/** v0.1 vocabulary, kept on `describeTwilioError().class` and `FailedResult.errorClass`. */
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

const CLASS_BY_ACTION: Readonly<Record<TwilioErrorAction, TwilioErrorClass>> = {
  alert_fatal: 'unregistered_sender',
  opt_out_retroactive: 'opted_out',
  unreachable_increment: 'unreachable',
  carrier_filtered: 'carrier_filtered',
  mark_landline: 'landline',
  mark_invalid: 'invalid_number',
  log_only: 'other',
};

export function twilioErrorClassOf(action: TwilioErrorAction): TwilioErrorClass {
  return CLASS_BY_ACTION[action];
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

/**
 * Twilio error messages can quote the destination ("The 'To' number
 * +1514… is not a valid phone number"). Logs never carry a phone number:
 * every run of 7+ digits (with the usual separators) is masked.
 */
export function redactPhoneNumbers(text: string): string {
  return text.replace(/\+?\(?\d(?:[\s().-]{0,2}\d){6,}/g, '[redacted-number]');
}

export interface TwilioErrorInfo extends TwilioErrorClassification {
  code?: number;
  status?: number;
  message: string;
  moreInfo?: string;
  class: TwilioErrorClass;
}

/** Extract what matters from whatever `messages.create()` rejected with. */
export function describeTwilioError(err: unknown): TwilioErrorInfo {
  const anyErr = (err ?? {}) as Record<string, unknown>;
  const code = parseTwilioErrorCode(anyErr.code);
  const status = typeof anyErr.status === 'number' ? anyErr.status : undefined;
  const moreInfo =
    typeof anyErr.moreInfo === 'string' ? anyErr.moreInfo : undefined;
  const message =
    typeof anyErr.message === 'string'
      ? anyErr.message
      : err instanceof Error
        ? err.message
        : String(err);
  const classification = classifyTwilioError(code);
  return {
    code,
    status,
    message,
    moreInfo,
    class: twilioErrorClassOf(classification.action),
    ...classification,
  };
}

/** Subset of `sms_consent.evidence` written by the TOT-207 effects. */
export interface TwilioErrorEvidence {
  unreachableCount?: number;
  unreachableSuspended?: boolean;
  landline?: boolean;
  invalid?: boolean;
  lastTwilioErrorCode?: number;
  lastTwilioErrorAt?: Date;
}

/**
 * TOT-207 — the fields to merge into `sms_consent.evidence` of EVERY consent
 * document of the number, so the webapp and Functions write the same thing.
 * `null` when the action has no per-number effect (`alert_fatal`,
 * `opt_out_retroactive` — that one writes `sms_opt_outs` —, `carrier_filtered`,
 * `log_only`). For `unreachable_increment` the caller passes the current
 * evidence of the document it is updating, inside its own transaction.
 */
export function consentEvidencePatch(
  action: TwilioErrorAction,
  current: Pick<TwilioErrorEvidence, 'unreachableCount'> | null | undefined,
  error: { code?: number; at: Date },
): TwilioErrorEvidence | null {
  const stamp: TwilioErrorEvidence = {
    ...(error.code !== undefined ? { lastTwilioErrorCode: error.code } : {}),
    lastTwilioErrorAt: error.at,
  };
  if (action === 'unreachable_increment') {
    const previous = Number(current?.unreachableCount);
    const unreachableCount =
      (Number.isFinite(previous) && previous > 0 ? Math.floor(previous) : 0) + 1;
    return {
      unreachableCount,
      ...(unreachableCount >= UNREACHABLE_SUSPEND_AFTER
        ? { unreachableSuspended: true }
        : {}),
      ...stamp,
    };
  }
  if (action === 'mark_landline') return { landline: true, ...stamp };
  if (action === 'mark_invalid') return { invalid: true, ...stamp };
  return null;
}
