# Changelog

## v0.1.0 — 2026-09-14

First publishable interface (TOT-187). Everything below is unit-tested with
fake `store` and `twilio`.

- `SmsStore`, `TwilioClientLike`, `Consent`, `OptOut`, `SmsMessageRecord` types
  (reference document §3).
- `normalizePhone(raw, defaultCountry = 'CA')` — libphonenumber-js (max
  metadata), valid **and SMS-capable** line types only. `+5142905402`
  rejected (`not_mobile`), `5142905402` → `+15142905402`, `" 1"` rejected.
- `createSmsGateway(deps).send(input)` — full pipeline: phone → suppression →
  consent table → quiet hours (`reminder`) → rate limiter + org/global caps →
  composition + STOP footer + segments → `messages.create` with
  `messagingServiceSid` and `statusCallback` → `sms_messages` record; error
  classification, 21610 → retroactive opt-out.
- `classifyInboundKeyword`, `calculateSmsSegments`, `decideConsent`,
  `decideFooter`, `classifyTwilioError`, quiet-hours helpers.
