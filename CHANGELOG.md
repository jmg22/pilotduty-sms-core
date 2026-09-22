# Changelog

## v0.2.1 — 2026-09-21

Wave 4, lot 2 (decisions P49 §5–6 and **P50 §0**, pilot reviews of Functions PR #14).

- **No raw Twilio text anymore.** `describeTwilioError().message` is passed
  through `redactPhoneNumbers` at the source (Twilio quotes the `To` number in
  21211 and others), so the gateway log, `FailedResult.errorMessage` and
  `sms_messages.errorMessage` are all redacted — a consumer that logs
  `errorMessage` no longer leaks the recipient. Network / non-Twilio
  rejections go through the same path. The `sms duplicate skipped` log also
  redacts the idempotency key (callers build it from the recipient).
- **Delivery marks refuse at send** (`decideConsent`, gateway step 3): a consent
  document carrying `evidence.invalid`, `evidence.landline` or
  `evidence.unreachableSuspended` is refused as `suppressed` with the new
  reasons **`invalid`**, **`landline`**, **`unreachable_suspended`**
  (`SuppressReason`, `ConsentRefusalReason`), before any counter or Twilio call.
  `opted_out` still wins. Only the boolean marks are read, never the raw counter.
  - `invalid` and `landline` refuse **every** category, `safety` included: the
    line physically cannot receive, so sending would be an illusion of safety.
  - `unreachableSuspended` refuses `transactional` and `reminder` but **not
    `safety`** (P50 §0): a phone that was off three times is not an invalid
    number, and the overdue alert must still go out — same exemption as the
    global daily cap. The send is counted as usual.
- `unreachableLiftPatch(at)` — the fields that lift a suspension
  (`unreachableCount: 0`, `unreachableSuspended: false`, `unreachableLiftedAt`):
  for the inbound webhook (any inbound SMS from the number) and the admin
  "retry" action. `invalid` / `landline` are never lifted.
- Not breaking: new union members only. A consumer with an exhaustive `switch`
  on `SuppressReason` must add the three reasons (the iOS relay maps them to
  its contract v1.3: `400 invalid_recipient` / `400 unreachable_suspended`).

## v0.2.0 — 2026-09-21

Wave 4, lot 1 (decisions P48 / P49): the Twilio error table (TOT-207) and the
global daily cap (TOT-209) live here, one truth for the webapp and Functions.
No new dependency.

### Breaking

- **`classifyTwilioError(code)` returns `{ action, severity, retry: false }`**
  instead of the `TwilioErrorClass` string of v0.1. Migration: read `.action`,
  or `twilioErrorClassOf(classifyTwilioError(code).action)` for the old
  vocabulary. `describeTwilioError().class` and `FailedResult.errorClass` are
  unchanged, so a consumer that only reads those (the webapp and Functions
  today — no direct caller found) needs no change. Accepted by the pilot for a
  0.x release (P49).

### Added / changed

- `classifyTwilioError` — the full TOT-207 table.
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
  atomic increment, refusal beyond `SMS_GLOBAL_DAILY_CAP` (default 3000 — the
  canonical name of P21, the only one read, no alias) except `category === 'safety'`
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
