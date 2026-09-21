# Changelog

## v0.2.0 — 2026-09-21

Wave 4, lot 1 (decision P48): the Twilio error table (TOT-207) and the global
daily cap (TOT-209) live here, one truth for the webapp and Functions. No new
dependency.

- **`classifyTwilioError(code)` now returns `{ action, severity, retry: false }`**
  (BREAKING for direct callers — it returned the class string in v0.1).
  Actions: `alert_fatal` (30034), `opt_out_retroactive` (21610),
  `unreachable_increment` (30003 / 30005, suspension at
  `UNREACHABLE_SUSPEND_AFTER = 3`), `carrier_filtered` (30007),
  `mark_landline` (30006), `mark_invalid` (21211 / 21614 / 21408), `log_only`
  (anything else, missing or non-numeric). Accepts the numeric string of the
  status callback (`ErrorCode`). The v0.1 class vocabulary survives on
  `describeTwilioError().class` and `FailedResult.errorClass`
  (`twilioErrorClassOf(action)`); both now also carry `action` / `severity` /
  `retry` (`errorAction` / `errorSeverity` / `retry` on `FailedResult`).
- `consentEvidencePatch(action, evidence, { code, at })` — the fields to merge
  into `sms_consent.evidence` (`unreachableCount`, `unreachableSuspended`,
  `landline`, `invalid`, `lastTwilioErrorCode`, `lastTwilioErrorAt`);
  `ConsentEvidence` extended accordingly.
- **`reserveGlobalDailySlot(db, { category, now, cap? })`** →
  `{ allowed, count, cap, day, threshold? }`: Firestore transaction on
  `sms_counters/global_{YYYY-MM-DD}` (UTC day, labelled `timezone: 'UTC'`),
  atomic increment, refusal beyond `SMS_DAILY_CAP_GLOBAL` (default 3000,
  legacy `SMS_GLOBAL_DAILY_CAP` still read) except `category === 'safety'`
  (counted, never refused); `threshold` `'warn'` at 80 % / `'cap'` at 100 %,
  once per day and per threshold (markers `thresholds.warn|cap` in the
  document). `db` is structural (`GlobalCounterDbLike`), compatible with the
  `{ day, count, updatedAt }` documents written by v0.1 stores.
- Gateway: optional `reserveGlobalSlot` dependency, called after consent, rate
  limits and the org monthly cap, before `messages.create()` →
  `suppressed / global_cap`. When provided, `caps.globalDaily` and the `global`
  figure of `store.incrementCounters` are ignored. Without it: v0.1 behaviour.
- Gateway: the retroactive opt-out on 21610 is written with
  **`source: 'twilio_21610'`** (was `'twilio_error'`, kept in `OptOutSource`
  for existing documents).
- Gateway: failure logs carry `action` and `severity`, and the Twilio message
  goes through `redactPhoneNumbers` (Twilio quotes the `To` number in 21211).
- Tests: every code of the table (number and string), unknown codes,
  non-numeric input; the counter at the limit, safety, UTC day change and
  concurrency — in memory (optimistic transactions) and against the Firestore
  emulator over its REST API (`npm run test:emulator`, no SDK needed).

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
