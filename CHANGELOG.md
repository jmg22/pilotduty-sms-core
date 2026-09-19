# Changelog

## v0.1.1 — 2026-09-19

French STOP footer made GSM-7 (TOT-199, decision P8).

- `STOP_FOOTERS.fr` is now ` Répondez STOP pour ne plus recevoir, AIDE pour
  de l'aide.` — 100 % GSM-7. The v0.1.0 wording (`… pour arrêter …`) contained
  `ê`, which flipped every French message carrying the footer to UCS-2
  (70 chars/segment instead of 160). `STOP_FOOTERS.en` is unchanged.
- Segment tests updated: FR body + FR footer is GSM-7 and fits one segment;
  the gateway no longer logs `footer_pushed_second_segment` for the `fr-CA`
  fixture. A non-GSM-7 character in the BODY still flips to UCS-2.
- Consumers that overrode the footer through `createSmsGateway({ footers })`
  to work around v0.1.0 can drop the override.

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
