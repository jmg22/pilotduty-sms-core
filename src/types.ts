/**
 * @pilotduty/sms-core — shared types.
 *
 * Zero runtime dependency on Twilio, Firebase or any framework: the Twilio
 * client and the Firestore-backed store are INJECTED by the caller (webapp,
 * Functions, iOS relay). Everything here is structural so the real `twilio`
 * client and any adapter satisfy it without importing this package's peers.
 *
 * Data model: "Plan de vol SMS PilotDuty — référence", §3.
 */

export type SmsCategory = 'transactional' | 'safety' | 'reminder';

export type ConsentStatus = 'opted_in' | 'attested' | 'opted_out' | 'unknown';

export type ConsentSource =
  | 'booking_widget'
  | 'back_office'
  | 'follower_form'
  | 'ios_flight_follower'
  | 'import'
  | 'inbound_keyword';

export interface ConsentEvidence {
  ip?: string;
  userAgent?: string;
  bookingId?: string;
  note?: string;
  /** TOT-207 — bumped on 30003/30005, number suspended after 3. */
  unreachableCount?: number;
}

/** `sms_consent/{e164}_{organizationId}` */
export interface Consent {
  phone: string;
  organizationId: string;
  status: ConsentStatus;
  source: ConsentSource;
  collectedAt: Date;
  /** userId | "self" | "system" */
  collectedBy: string;
  /** e.g. "2026-09-v1" — the wording shown when consent was collected. */
  textVersion?: string;
  locale?: string;
  evidence?: ConsentEvidence;
  updatedAt?: Date;
}

export type OptOutSource = 'inbound_keyword' | 'twilio_error';

/** `sms_opt_outs/{e164}` */
export interface OptOut {
  /** The keyword received (STOP, ARRET, …) or the Twilio error code ("21610"). */
  keyword: string;
  at: Date;
  messageSid?: string;
  source: OptOutSource;
  /** Sender of the inbound message, when `source = inbound_keyword`. */
  from?: string;
}

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export type SmsMessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'suppressed';

export type SuppressReason =
  | 'invalid_phone'
  | 'opted_out'
  | 'reminder_without_booking'
  | 'rate_limited'
  | 'org_cap'
  | 'global_cap'
  | 'duplicate';

/** `sms_messages/{sid | generatedId}` — retention 13 months (TOT-205). */
export interface SmsMessageRecord {
  /** Twilio `MessageSid` when accepted by Twilio, otherwise a generated id. */
  id: string;
  to: string;
  organizationId: string;
  templateId: string;
  category: SmsCategory;
  locale: string;
  segments: number;
  encoding: SmsEncoding;
  status: SmsMessageStatus;
  errorCode?: number;
  errorMessage?: string;
  suppressReason?: SuppressReason;
  /** Number or alpha sender actually used, as returned by Twilio. */
  sender?: string;
  /** Whether the STOP/HELP footer was appended (TOT-199). */
  footerApplied?: boolean;
  idempotencyKey?: string;
  sentAt: Date;
  updatedAt: Date;
}

/**
 * Storage adapter supplied by the caller (Firestore via firebase-admin in
 * practice — never imported here).
 *
 * Counter semantics for `incrementCounters(orgId, day)`:
 *   - `org`    = the organization's count for the CALENDAR MONTH containing
 *                `day` (existing `org_sms_counters/{orgId}_{YYYY-MM}`), after
 *                this increment;
 *   - `global` = the platform-wide count for `day` (`sms_counters/global_{day}`),
 *                after this increment.
 * The gateway increments BEFORE `messages.create()` (reservation): an attempt
 * that Twilio then rejects still consumes one unit. That is an economic
 * guard, not a security gate (see monthly-cap.ts in PilotDutySaas).
 *
 * `lastMessageAt(e164)` = time of the most recent message HANDED TO TWILIO
 * for that number (status ≠ suppressed), any organization — drives the
 * 30-day first-contact footer (TOT-199).
 */
export interface SmsStore {
  getConsent(e164: string, orgId: string): Promise<Consent | null>;
  getOptOut(e164: string): Promise<OptOut | null>;
  writeOptOut(e164: string, data: OptOut): Promise<void>;
  writeMessage(msg: SmsMessageRecord): Promise<void>;
  incrementCounters(
    orgId: string,
    day: string,
  ): Promise<{ org: number; global: number }>;
  lastMessageAt(e164: string): Promise<Date | null>;
  /**
   * Optional. When provided and it returns `true`, `send()` returns
   * `suppressed/duplicate` without touching Twilio or the counters.
   */
  hasIdempotencyKey?(key: string): Promise<boolean>;
}

/** Structural subset of the real `twilio` client — never imported here. */
export interface TwilioMessageCreateParams {
  to: string;
  body: string;
  messagingServiceSid: string;
  statusCallback?: string;
}

export interface TwilioMessageLike {
  sid: string;
  /** Sender actually used (number or alpha). */
  from?: string | null;
  status?: string | null;
  numSegments?: string | null;
}

export interface TwilioClientLike {
  messages: {
    create(params: TwilioMessageCreateParams): Promise<TwilioMessageLike>;
  };
}

export interface SmsLogger {
  debug?(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}
