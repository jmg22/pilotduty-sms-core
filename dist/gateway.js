"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BODY_LENGTH = void 0;
exports.createSmsGateway = createSmsGateway;
const consent_1 = require("./consent");
const errors_1 = require("./errors");
const phone_1 = require("./phone");
const quiet_hours_1 = require("./quiet-hours");
const template_1 = require("./template");
/** Twilio hard limit on `Body`. */
exports.MAX_BODY_LENGTH = 1600;
const consoleLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (msg, ctx) => console.warn(`[sms-core] ${msg}`, ctx ?? ''),
    error: (msg, ctx) => console.error(`[sms-core] ${msg}`, ctx ?? ''),
};
function generateId(prefix) {
    const uuid = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    return `${prefix}_${uuid.replace(/-/g, '')}`;
}
function utcDay(date) {
    return date.toISOString().slice(0, 10);
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
function createSmsGateway(deps) {
    const now = deps.now ?? (() => new Date());
    const logger = deps.logger ?? consoleLogger;
    const footers = deps.footers ?? template_1.STOP_FOOTERS;
    const quietHours = deps.quietHours ?? quiet_hours_1.DEFAULT_QUIET_HOURS;
    if (!deps.messagingServiceSid) {
        throw new Error('[sms-core] messagingServiceSid is required');
    }
    async function record(partial) {
        const at = now();
        await deps.store.writeMessage({ ...partial, sentAt: at, updatedAt: at });
    }
    async function suppress(input, to, reason, extra = {}) {
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
    async function resolveBody(input) {
        if (typeof input.body === 'string')
            return input.body;
        if (!deps.templates) {
            throw new Error(`[sms-core] no template catalogue configured and no body given for template "${input.templateId}"`);
        }
        const template = await deps.templates(input.templateId, input.locale);
        if (!template) {
            throw new Error(`[sms-core] unknown template "${input.templateId}" for locale "${input.locale}"`);
        }
        const rendered = (0, template_1.renderTemplate)(template, input.params ?? {});
        if (rendered.missing.length > 0) {
            logger.warn('template placeholders without value', {
                templateId: input.templateId,
                locale: input.locale,
                missing: rendered.missing,
            });
        }
        return rendered.body;
    }
    async function send(input) {
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
        const phone = (0, phone_1.normalizePhone)(input.to, input.defaultCountry);
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
        const decision = (0, consent_1.decideConsent)(consent, input.category, {
            confirmedBookingExists: input.confirmedBookingExists,
        });
        if (!decision.allow) {
            return suppress(input, e164, decision.reason ?? 'opted_out', {
                detail: `consent=${decision.effectiveStatus}`,
            });
        }
        // 4. Quiet hours — reminders only, recipient's zone when known.
        if (input.category === 'reminder') {
            if ((0, quiet_hours_1.isValidTimeZone)(input.timeZone)) {
                if ((0, quiet_hours_1.isWithinQuietHours)(at, input.timeZone, quietHours)) {
                    const deferUntil = (0, quiet_hours_1.nextQuietHoursEnd)(at, input.timeZone, quietHours);
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
            }
            else {
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
        const counters = await deps.store.incrementCounters(input.organizationId, utcDay(at));
        if (counters.org > deps.caps.perOrgMonthly) {
            return suppress(input, e164, 'org_cap', {
                detail: `${counters.org}/${deps.caps.perOrgMonthly}`,
            });
        }
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
        }
        else if (globalRatio >= 0.8) {
            logger.warn('global daily SMS cap at 80%', {
                global: counters.global,
                cap: deps.caps.globalDaily,
            });
        }
        // 6. Composition, STOP footer, segments.
        const rawBody = await resolveBody(input);
        const lastMessageAt = await deps.store.lastMessageAt(e164);
        const footerDecision = (0, template_1.decideFooter)({
            category: input.category,
            consentStatus: decision.effectiveStatus,
            lastMessageAt,
            now: at,
        });
        const composed = (0, template_1.applyFooter)(rawBody, (0, template_1.footerFor)(input.locale, footers), footerDecision.needed || decision.forceFooter);
        if (composed.footerPushedSegment) {
            logger.warn('footer_pushed_second_segment', {
                templateId: input.templateId,
                locale: input.locale,
                segmentsBeforeFooter: composed.segmentsBeforeFooter,
                segments: composed.segments,
                encoding: composed.encoding,
            });
        }
        if (composed.body.length > exports.MAX_BODY_LENGTH) {
            throw new Error(`[sms-core] body exceeds ${exports.MAX_BODY_LENGTH} characters for template "${input.templateId}"`);
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
        }
        catch (err) {
            // 8b. Failure: classify, record, retroactive opt-out on 21610.
            const info = (0, errors_1.describeTwilioError)(err);
            const messageId = generateId('fail');
            await record({
                ...base,
                id: messageId,
                status: 'failed',
                errorCode: info.code,
                errorMessage: info.message,
            });
            if (info.class === 'opted_out') {
                await deps.store.writeOptOut(e164, {
                    keyword: String(info.code),
                    at,
                    source: 'twilio_error',
                });
            }
            const logCtx = {
                organizationId: input.organizationId,
                templateId: input.templateId,
                code: info.code,
                errorClass: info.class,
                moreInfo: info.moreInfo,
                message: info.message,
            };
            if (info.class === 'unregistered_sender') {
                logger.error('twilio 30034: sender not registered for A2P', logCtx);
            }
            else {
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
        normalizePhone: (raw, defaultCountry) => (0, phone_1.normalizePhone)(raw, defaultCountry),
    };
}
//# sourceMappingURL=gateway.js.map