import { type ConsentContext } from './consent';
import { type TwilioErrorClass } from './errors';
import { type CountryCode, type E164, type InvalidPhone } from './phone';
import { type QuietHoursWindow } from './quiet-hours';
import { type TemplateResolver } from './template';
import type { SmsCategory, SmsEncoding, SmsLogger, SmsStore, SuppressReason, TwilioClientLike } from './types';
/** Twilio hard limit on `Body`. */
export declare const MAX_BODY_LENGTH = 1600;
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
    errorMessage: string;
    moreInfo?: string;
}
export type SendResult = SentResult | SuppressedResult | DeferredResult | FailedResult;
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
    caps: {
        perOrgMonthly: number;
        globalDaily: number;
    };
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
/**
 * Build the single SMS send path shared by the webapp, Functions and the iOS
 * relay. Pipeline (TOT-187), in order:
 *
 *  1. normalizePhone            → suppressed/invalid_phone
 *  2. sms_opt_outs              → suppressed/opted_out            (TOT-198)
 *  3. consent table             → suppressed/reminder_without_booking (TOT-193)
 *  4. quiet hours (reminder)    → deferred/quiet_hours            (TOT-204)
 *  5. rate limits, org + global caps → suppressed/rate_limited|org_cap|global_cap (TOT-209)
 *  6. compose + STOP footer + segments                             (TOT-199, TOT-240)
 *  7. messages.create({ messagingServiceSid, statusCallback, to, body })
 *  8. writeMessage; error classification, 21610 → writeOptOut      (TOT-205, TOT-207)
 *
 * Every refusal is written to `sms_messages` with `status = suppressed` so it
 * shows on the dashboard (TOT-210). A deferral writes nothing: the caller
 * re-submits at `deferUntil`. Twilio failures never throw — they come back
 * as `status = 'failed'` with the classified code. Only programming/config
 * errors throw (unknown template, body over 1600 chars, missing store).
 */
export declare function createSmsGateway(deps: SmsGatewayDeps): SmsGateway;
//# sourceMappingURL=gateway.d.ts.map