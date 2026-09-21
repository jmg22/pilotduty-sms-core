import { decideConsent, type ConsentContext } from './consent';
import {
  describeTwilioError,
  redactPhoneNumbers,
  type TwilioErrorAction,
  type TwilioErrorClass,
  type TwilioErrorSeverity,
} from './errors';
import { utcDay, type GlobalDailySlot } from './global-cap';
import { normalizePhone, type CountryCode, type E164, type InvalidPhone } from './phone';
import {
  DEFAULT_QUIET_HOURS,
  isValidTimeZone,
  isWithinQuietHours,
  nextQuietHoursEnd,
  type QuietHoursWindow,
} from './quiet-hours';
import {
  applyFooter,
  decideFooter,
  footerFor,
  renderTemplate,
  STOP_FOOTERS,
  type TemplateResolver,
} from './template';
import type {
  SmsCategory,
  SmsEncoding,
  SmsLogger,
  SmsMessageRecord,
  SmsStore,
  SuppressReason,
  TwilioClientLike,
} from './types';

/** Twilio hard limit on `Body`. */
export const MAX_BODY_LENGTH = 1600;

export interface SendInput extends ConsentContext {
  to: string;
  organizationId: string;
  templateId: string;
  params: Record<string, string>;
  category: SmsCategory;
  locale: string;
  idempotencyKey?: string;
  /**
   * Already-composed body. When present the template catalogue is NOT
   * consulted (migration path: the webapp's notification engine composes
   * family-A messages from org-overridable variants today). The STOP footer
   * is still applied by the gateway.
   */
  body?: string;
  /** Interpret a national-format `to` in this country (default CA). */
  defaultCountry?: CountryCode;
  /**
   * IANA zone of the recipient (organization's base, or derived from the
   * number by the caller). Quiet hours only apply when known and only to
   * `reminder`. Unknown/invalid zone → no deferral, logged once per send.
   */
  timeZone?: string;
}

export interface SendResultBase {
  /** Normalized E.164 when the number parsed, otherwise the raw input. */
  to: string;
  segments: number;
  encoding: SmsEncoding;
  /** `sms_messages` document id (Twilio sid or generated). */
  messageId?: string;
}

export interface SentResult extends SendResultBase {
  status: 'sent';
  sid: string;
  messageId: string;
  footerApplied: boolean;
  /** Sender actually used, when Twilio returns it. */
  sender?: string;
}

export interface SuppressedResult extends SendResultBase {
  status: 'suppressed';
  reason: SuppressReason;
  retryAfterSec?: number;
  detail?: string;
}

export interface DeferredResult extends SendResultBase {
  status: 'deferred';
  reason: 'quiet_hours';
  deferUntil: Date;
}

export interface FailedResult extends SendResultBase {
  status: 'failed';
  messageId: string;
  errorCode?: number;
  errorClass: TwilioErrorClass;
  /** TOT-207 — what the caller must do with this failure (`classifyTwilioError`). */
  errorAction: TwilioErrorAction;
  /** Sentry level for the caller's report. */
  errorSeverity: TwilioErrorSeverity;
  /** Always `false`: a Twilio refusal is never retried. */
  retry: false;
  errorMessage: string;
  moreInfo?: string;
}

export type SendResult =
  | SentResult
  | SuppressedResult
  | DeferredResult
  | FailedResult;

export interface RateLimitCheck {
  ok: boolean;
  retryAfterSec?: number;
  /** Which dimension blocked (ip, phone, organizationId, …). */
  blockedBy?: string;
}

export interface SmsGatewayDeps {
  twilio: TwilioClientLike;
  store: SmsStore;
  messagingServiceSid: string;
  statusCallbackUrl: string;
  caps: { perOrgMonthly: number; globalDaily: number };
  /**
   * TOT-209 — reservation of the platform-wide daily quota, normally
   * `(i) => reserveGlobalDailySlot(db, i)` wrapped by the caller to report
   * `threshold` to Sentry. Called AFTER consent, rate limits and the
   * per-organization monthly cap, BEFORE `messages.create()`. When provided
   * it is the only global guard: `caps.globalDaily` and the `global` figure
   * of `store.incrementCounters` are ignored (the store must then stop
   * incrementing the global counter itself, or the day is counted twice).
   */
  reserveGlobalSlot?: (input: {
    category: SmsCategory;
    now: Date;
  }) => Promise<GlobalDailySlot>;
  now?: () => Date;
  /** Template catalogue. Required unless every `send()` passes `body`. */
  templates?: TemplateResolver;
  /**
   * Existing per-recipient / per-org rate limits (Upstash in the webapp).
   * Called after consent and quiet hours, before the caps.
   */
  rateLimiter?: (input: SendInput, e164: string) => Promise<RateLimitCheck>;
  logger?: SmsLogger;
  footers?: Readonly<Record<string, string>>;
  quietHours?: QuietHoursWindow;
}

export interface SmsGateway {
  send(input: SendInput): Promise<SendResult>;
  normalizePhone(raw: string, defaultCountry?: CountryCode): E164 | InvalidPhone;
}

const consoleLogger: SmsLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (msg, ctx) => console.warn(`[sms-core] ${msg}`, ctx ?? ''),
  error: (msg, ctx) => console.error(`[sms-core] ${msg}`, ctx ?? ''),
};

function generateId(prefix: string): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${uuid.replace(/-/g, '')}`;
}

/**
 * Build the single SMS send path shared by the webapp, Functions and the iOS
 * relay. Pipeline (TOT-187), in order:
 *
 *  1. normalizePhone            → suppressed/invalid_phone
 *  2. sms_opt_outs              → suppressed/opted_out            (TOT-198)
 *  3. consent table             → suppressed/reminder_without_booking (TOT-193)
 *  4. quiet hours (reminder)    → deferred/quiet_hours            (TOT-204)
 *  5. rate limits, org cap, then global daily slot → suppressed/rate_limited|org_cap|global_cap (TOT-209)
 *  6. compose + STOP footer + segments                             (TOT-199, TOT-240)
 *  7. messages.create({ messagingServiceSid, statusCallback, to, body })
 *  8. writeMessage; error classification (`errorAction`), 21610 → writeOptOut `twilio_21610` (TOT-205, TOT-207)
 *
 * Every refusal is written to `sms_messages` with `status = suppressed` so it
 * shows on the dashboard (TOT-210). A deferral writes nothing: the caller
 * re-submits at `deferUntil`. Twilio failures never throw — they come back
 * as `status = 'failed'` with the classified code. Only programming/config
 * errors throw (unknown template, body over 1600 chars, missing store).
 */
export function createSmsGateway(deps: SmsGatewayDeps): SmsGateway {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? consoleLogger;
  const footers = deps.footers ?? STOP_FOOTERS;
  const quietHours = deps.quietHours ?? DEFAULT_QUIET_HOURS;

  if (!deps.messagingServiceSid) {
    throw new Error('[sms-core] messagingServiceSid is required');
  }

  async function record(
    partial: Omit<SmsMessageRecord, 'sentAt' | 'updatedAt'>,
  ): Promise<void> {
    const at = now();
    await deps.store.writeMessage({ ...partial, sentAt: at, updatedAt: at });
  }

  async function suppress(
    input: SendInput,
    to: string,
    reason: SuppressReason,
    extra: {
      segments?: number;
      encoding?: SmsEncoding;
      retryAfterSec?: number;
      detail?: string;
    } = {},
  ): Promise<SuppressedResult> {
    const messageId = generateId('sup');
    await record({
      id: messageId,
      to,
      organizationId: input.organizationId,
      templateId: input.templateId,
      category: input.category,
      locale: input.locale,
      segments: extra.segments ?? 0,
      encoding: extra.encoding ?? 'GSM-7',
      status: 'suppressed',
      suppressReason: reason,
      idempotencyKey: input.idempotencyKey,
    });
    logger.info('sms suppressed', {
      reason,
      organizationId: input.organizationId,
      templateId: input.templateId,
      category: input.category,
      detail: extra.detail,
    });
    return {
      status: 'suppressed',
      reason,
      to,
      messageId,
      segments: extra.segments ?? 0,
      encoding: extra.encoding ?? 'GSM-7',
      retryAfterSec: extra.retryAfterSec,
      detail: extra.detail,
    };
  }

  async function resolveBody(input: SendInput): Promise<string> {
    if (typeof input.body === 'string') return input.body;
    if (!deps.templates) {
      throw new Error(
        `[sms-core] no template catalogue configured and no body given for template "${input.templateId}"`,
      );
    }
    const template = await deps.templates(input.templateId, input.locale);
    if (!template) {
      throw new Error(
        `[sms-core] unknown template "${input.templateId}" for locale "${input.locale}"`,
      );
    }
    const rendered = renderTemplate(template, input.params ?? {});
    if (rendered.missing.length > 0) {
      logger.warn('template placeholders without value', {
        templateId: input.templateId,
        locale: input.locale,
        missing: rendered.missing,
      });
    }
    return rendered.body;
  }

  async function send(input: SendInput): Promise<SendResult> {
    const at = now();

    // 0. Idempotency (optional store capability).
    if (input.idempotencyKey && deps.store.hasIdempotencyKey) {
      const seen = await deps.store.hasIdempotencyKey(input.idempotencyKey);
      if (seen) {
        logger.info('sms duplicate skipped', { idempotencyKey: input.idempotencyKey });
        return {
          status: 'suppressed',
          reason: 'duplicate',
          to: input.to,
          segments: 0,
          encoding: 'GSM-7',
        };
      }
    }

    // 1. Phone normalization.
    const phone = normalizePhone(input.to, input.defaultCountry);
    if (!phone.ok) {
      return suppress(input, input.to, 'invalid_phone', {
        detail: `${phone.reason}${phone.country ? ` (${phone.country})` : ''}`,
      });
    }
    const e164 = phone.e164;

    // 2. Suppression list.
    const optOut = await deps.store.getOptOut(e164);
    if (optOut) {
      return suppress(input, e164, 'opted_out', {
        detail: `${optOut.source}:${optOut.keyword}`,
      });
    }

    // 3. Consent.
    const consent = await deps.store.getConsent(e164, input.organizationId);
    const decision = decideConsent(consent, input.category, {
      confirmedBookingExists: input.confirmedBookingExists,
    });
    if (!decision.allow) {
      return suppress(input, e164, decision.reason ?? 'opted_out', {
        detail: `consent=${decision.effectiveStatus}`,
      });
    }

    // 4. Quiet hours — reminders only, recipient's zone when known.
    if (input.category === 'reminder') {
      if (isValidTimeZone(input.timeZone)) {
        if (isWithinQuietHours(at, input.timeZone, quietHours)) {
          const deferUntil = nextQuietHoursEnd(at, input.timeZone, quietHours);
          logger.info('sms deferred (quiet hours)', {
            organizationId: input.organizationId,
            templateId: input.templateId,
            timeZone: input.timeZone,
            deferUntil: deferUntil.toISOString(),
          });
          return {
            status: 'deferred',
            reason: 'quiet_hours',
            to: e164,
            deferUntil,
            segments: 0,
            encoding: 'GSM-7',
          };
        }
      } else {
        logger.warn('quiet hours skipped: no valid time zone for reminder', {
          organizationId: input.organizationId,
          templateId: input.templateId,
          timeZone: input.timeZone,
        });
      }
    }

    // 5. Rate limits (existing) then org + global caps.
    if (deps.rateLimiter) {
      const rl = await deps.rateLimiter(input, e164);
      if (!rl.ok) {
        return suppress(input, e164, 'rate_limited', {
          retryAfterSec: rl.retryAfterSec,
          detail: rl.blockedBy,
        });
      }
    }
    const counters = await deps.store.incrementCounters(
      input.organizationId,
      utcDay(at),
    );
    if (counters.org > deps.caps.perOrgMonthly) {
      return suppress(input, e164, 'org_cap', {
        detail: `${counters.org}/${deps.caps.perOrgMonthly}`,
      });
    }
    if (deps.reserveGlobalSlot) {
      const slot = await deps.reserveGlobalSlot({ category: input.category, now: at });
      if (slot.threshold === 'cap') {
        logger.error('global daily SMS cap reached', {
          global: slot.count,
          cap: slot.cap,
          day: slot.day,
          category: input.category,
        });
      } else if (slot.threshold === 'warn') {
        logger.warn('global daily SMS cap at 80%', {
          global: slot.count,
          cap: slot.cap,
          day: slot.day,
        });
      }
      if (!slot.allowed) {
        return suppress(input, e164, 'global_cap', {
          detail: `${slot.count}/${slot.cap}`,
        });
      }
    } else {
      // v0.1 path: the store counts the day itself, no once-a-day marker.
      if (counters.global > deps.caps.globalDaily && input.category !== 'safety') {
        return suppress(input, e164, 'global_cap', {
          detail: `${counters.global}/${deps.caps.globalDaily}`,
        });
      }
      const globalRatio = counters.global / deps.caps.globalDaily;
      if (globalRatio >= 1) {
        logger.error('global daily SMS cap reached', {
          global: counters.global,
          cap: deps.caps.globalDaily,
          category: input.category,
        });
      } else if (globalRatio >= 0.8) {
        logger.warn('global daily SMS cap at 80%', {
          global: counters.global,
          cap: deps.caps.globalDaily,
        });
      }
    }

    // 6. Composition, STOP footer, segments.
    const rawBody = await resolveBody(input);
    const lastMessageAt = await deps.store.lastMessageAt(e164);
    const footerDecision = decideFooter({
      category: input.category,
      consentStatus: decision.effectiveStatus,
      lastMessageAt,
      now: at,
    });
    const composed = applyFooter(
      rawBody,
      footerFor(input.locale, footers),
      footerDecision.needed || decision.forceFooter,
    );
    if (composed.footerPushedSegment) {
      logger.warn('footer_pushed_second_segment', {
        templateId: input.templateId,
        locale: input.locale,
        segmentsBeforeFooter: composed.segmentsBeforeFooter,
        segments: composed.segments,
        encoding: composed.encoding,
      });
    }
    if (composed.body.length > MAX_BODY_LENGTH) {
      throw new Error(
        `[sms-core] body exceeds ${MAX_BODY_LENGTH} characters for template "${input.templateId}"`,
      );
    }
    if (composed.body.trim().length === 0) {
      throw new Error(`[sms-core] empty body for template "${input.templateId}"`);
    }

    // 7. Twilio.
    const base = {
      to: e164,
      organizationId: input.organizationId,
      templateId: input.templateId,
      category: input.category,
      locale: input.locale,
      segments: composed.segments,
      encoding: composed.encoding,
      footerApplied: composed.footerApplied,
      idempotencyKey: input.idempotencyKey,
    };
    let message;
    try {
      message = await deps.twilio.messages.create({
        messagingServiceSid: deps.messagingServiceSid,
        statusCallback: deps.statusCallbackUrl,
        to: e164,
        body: composed.body,
      });
    } catch (err) {
      // 8b. Failure: classify, record, retroactive opt-out on 21610.
      const info = describeTwilioError(err);
      const messageId = generateId('fail');
      await record({
        ...base,
        id: messageId,
        status: 'failed',
        errorCode: info.code,
        errorMessage: info.message,
      });
      if (info.action === 'opt_out_retroactive') {
        // P48: an unsubscription seen by the carrier is a STOP — the write
        // legitimately triggers the STOP notices (pilot, organization admins).
        await deps.store.writeOptOut(e164, {
          keyword: String(info.code),
          at,
          source: 'twilio_21610',
        });
      }
      // Always `code` and `moreInfo`, never the number (Twilio quotes it in
      // some messages).
      const logCtx = {
        organizationId: input.organizationId,
        templateId: input.templateId,
        code: info.code,
        action: info.action,
        severity: info.severity,
        errorClass: info.class,
        moreInfo: info.moreInfo,
        message: redactPhoneNumbers(info.message),
      };
      if (info.action === 'alert_fatal') {
        logger.error('twilio 30034: sender not registered for A2P', logCtx);
      } else {
        logger.warn('twilio send failed', logCtx);
      }
      return {
        status: 'failed',
        to: e164,
        messageId,
        segments: composed.segments,
        encoding: composed.encoding,
        errorCode: info.code,
        errorClass: info.class,
        errorAction: info.action,
        errorSeverity: info.severity,
        retry: false,
        errorMessage: info.message,
        moreInfo: info.moreInfo,
      };
    }

    // 8a. Success: record with the Twilio sid; delivery status arrives via
    // the status callback (TOT-206).
    const sender = message.from ?? undefined;
    await record({
      ...base,
      id: message.sid,
      status: 'queued',
      sender,
    });
    logger.info('sms handed to twilio', {
      sid: message.sid,
      organizationId: input.organizationId,
      templateId: input.templateId,
      category: input.category,
      segments: composed.segments,
      encoding: composed.encoding,
      footerApplied: composed.footerApplied,
    });
    return {
      status: 'sent',
      sid: message.sid,
      messageId: message.sid,
      to: e164,
      segments: composed.segments,
      encoding: composed.encoding,
      footerApplied: composed.footerApplied,
      sender,
    };
  }

  return {
    send,
    normalizePhone: (raw, defaultCountry) => normalizePhone(raw, defaultCountry),
  };
}
