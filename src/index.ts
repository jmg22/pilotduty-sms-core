export * from './types';
export {
  normalizePhone,
  isSmsCapablePhone,
  toE164,
  DEFAULT_PHONE_COUNTRY,
  type E164,
  type InvalidPhone,
  type InvalidPhoneReason,
  type CountryCode,
  type NumberType,
} from './phone';
export {
  calculateSmsSegments,
  detectSmsEncoding,
  isGsm7,
  SMS_LIMITS,
  type SmsSegmentInfo,
} from './segments';
export {
  classifyInboundKeyword,
  normalizeKeyword,
  OPT_OUT_KEYWORDS,
  OPT_IN_KEYWORDS,
  HELP_KEYWORDS,
  type InboundKeywordKind,
  type InboundKeywordMatch,
} from './keywords';
export {
  decideConsent,
  type ConsentDecision,
  type ConsentContext,
  type ConsentRefusalReason,
} from './consent';
export {
  DEFAULT_QUIET_HOURS,
  isWithinQuietHours,
  nextQuietHoursEnd,
  isValidTimeZone,
  localHour,
  zonedTimeToUtc,
  wallClock,
  type QuietHoursWindow,
} from './quiet-hours';
export {
  classifyTwilioError,
  describeTwilioError,
  isPermanentTwilioError,
  type TwilioErrorClass,
  type TwilioErrorInfo,
} from './errors';
export {
  renderTemplate,
  decideFooter,
  applyFooter,
  footerFor,
  baseLanguage,
  STOP_FOOTERS,
  FIRST_CONTACT_WINDOW_DAYS,
  type TemplateResolver,
  type RenderedTemplate,
  type FooterDecision,
  type FooterReason,
  type ComposedBody,
} from './template';
export {
  createSmsGateway,
  MAX_BODY_LENGTH,
  type SmsGateway,
  type SmsGatewayDeps,
  type SendInput,
  type SendResult,
  type SentResult,
  type SuppressedResult,
  type DeferredResult,
  type FailedResult,
  type RateLimitCheck,
} from './gateway';
