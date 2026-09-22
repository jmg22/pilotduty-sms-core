# @pilotduty/sms-core

The single SMS send path for PilotDuty — shared by **PilotDutySaas** (Next.js on
Vercel), **PilotDutyFunctions** (Firebase) and the iOS relay (TOT-178).
Linear: [TOT-187](https://linear.app/pilotduty/issue/TOT-187), project
"Twilio A2P — Restructuration". Rules come from the project document
« Plan de vol SMS PilotDuty — référence » (§3 data model, §5 writing rules).

TypeScript strict, no framework, no runtime import of `twilio` or
`firebase-admin`: the Twilio client and the Firestore store are **injected**.

## Install (pinned git tag)

```json
"@pilotduty/sms-core": "git+https://github.com/jmg22/pilotduty-sms-core.git#v0.2.1"
```

Always `git+https` in `package.json` AND in the lock (`resolved`), never
`git+ssh` — npm rewrites it on `npm install`; check with `grep git+ssh`.

`dist/` is committed, so consumers never build this package. Node ≥ 20.
The only runtime dependency is `libphonenumber-js` (max metadata, for line
types).

## Usage

```ts
import twilio from 'twilio';
import { createSmsGateway, type SmsStore } from '@pilotduty/sms-core';

const store: SmsStore = firestoreSmsStore(getFirestore()); // your adapter

const gateway = createSmsGateway({
  twilio: twilio(apiKeySid, apiKeySecret, { accountSid }),
  store,
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID!,
  statusCallbackUrl: 'https://manager.pilotduty.com/api/twilio/status',
  caps: { perOrgMonthly: 2000, globalDaily: 3000 },
  templates: (templateId, locale) => catalogue.lookup(templateId, locale),
  rateLimiter: async (input, e164) => checkDistributedRateLimit(/* … */),
  logger: pinoAdapter, // (msg, ctx) — adapt to pino's (obj, msg) order
});

const result = await gateway.send({
  to: '514 290 5402',            // normalized to +15142905402
  organizationId: 'org_123',
  templateId: 'booking_confirmed',
  params: { 'organization.name': 'Totem Aviation', date: 'Sep 20' },
  category: 'transactional',     // 'transactional' | 'safety' | 'reminder'
  locale: 'fr-CA',
  timeZone: 'America/Toronto',   // recipient zone; quiet hours for reminders
  confirmedBookingExists: true,  // required for reminders to unknown numbers
  idempotencyKey: 'booking_123:reminder:24h',
});

switch (result.status) {
  case 'sent':       // handed to Twilio — result.sid, result.footerApplied
  case 'suppressed': // result.reason: invalid_phone | opted_out | reminder_without_booking | invalid | landline | unreachable_suspended | rate_limited | org_cap | global_cap | duplicate
  case 'deferred':   // quiet hours — re-submit at result.deferUntil
  case 'failed':     // Twilio rejected — result.errorCode, result.errorClass
}
```

`gateway.normalizePhone(raw, defaultCountry = 'CA')` is exported on its own
too (`normalizePhone`, `toE164`, `isSmsCapablePhone`) for forms.

## Pipeline of `send()`, in order

| # | Step | Outcome when it stops | Issue |
| - | ---- | --------------------- | ----- |
| 1 | `normalizePhone` — valid **and SMS-capable** for its country | `suppressed / invalid_phone` | TOT-275, TOT-195 |
| 2 | `sms_opt_outs/{e164}` exists | `suppressed / opted_out` | TOT-198 |
| 3 | Consent table (`opted_in` / `attested` / `unknown` / `opted_out`) | `suppressed / opted_out`, `reminder_without_booking`, or a delivery mark: `invalid` / `landline` / `unreachable_suspended` | TOT-193, TOT-207 |
| 4 | Quiet hours 21:00–08:00 recipient local, `reminder` only | `deferred / quiet_hours` + `deferUntil` | TOT-204 |
| 5 | Injected rate limiter, then org monthly cap, then global daily slot (`reserveGlobalSlot`, `safety` exempt) | `suppressed / rate_limited`, `org_cap`, `global_cap` | TOT-209 |
| 6 | Template → `{{params}}`; STOP footer on first contact in 30 days, on `safety`, or when consent ≠ `opted_in`; segments/encoding | — | TOT-199, TOT-240 |
| 7 | `messages.create({ messagingServiceSid, statusCallback, to, body })` | — | TOT-186 |
| 8 | `writeMessage` (`status = queued`, Twilio sid); on error: classify, record `failed`, **21610 → `writeOptOut`** | `failed` | TOT-205, TOT-207 |

Every refusal is written to `sms_messages` with `status = suppressed` and a
reason (dashboard, TOT-210). A deferral writes nothing. Twilio errors never
throw. Only configuration errors throw (unknown template, empty body, body
over 1600 characters, missing `messagingServiceSid`).

### Phone rule (TOT-275)

`+5142905402` is a **valid** Peruvian landline for libphonenumber, so
validity alone does not reject it. The gateway requires a line type that can
receive SMS (`MOBILE`, `FIXED_LINE_OR_MOBILE`, or unknown-but-valid) — that
rejects it with `reason = 'not_mobile'`, and also rejects any landline that
would come back as Twilio 30006. `5142905402` with the CA default becomes
`+15142905402`.

### Store contract

See `SmsStore` in `src/types.ts` (Firestore collections `sms_consent`,
`sms_opt_outs`, `sms_messages`, `org_sms_counters`, `sms_counters`).
`incrementCounters(orgId, day)` returns the org's **monthly** count and the
platform's **daily** count after incrementing; it runs **before**
`messages.create()` (reservation).

### Global daily cap (v0.2.0, TOT-209)

```ts
import { createSmsGateway, reserveGlobalDailySlot } from '@pilotduty/sms-core';

const gateway = createSmsGateway({
  // …
  reserveGlobalSlot: async (input) => {
    const slot = await reserveGlobalDailySlot(admin.firestore(), input);
    if (slot.threshold === 'warn') Sentry.captureMessage('sms global cap 80 %', 'warning');
    if (slot.threshold === 'cap') Sentry.captureMessage('sms global cap reached', 'error');
    return slot;
  },
});
```

`reserveGlobalDailySlot(db, { category, now, cap? })` →
`{ allowed, count, cap, day, threshold? }`. One Firestore transaction on
`sms_counters/global_{YYYY-MM-DD}` (**UTC** day, `timezone: 'UTC'` in the
document): atomic increment, refusal beyond `SMS_GLOBAL_DAILY_CAP` (default
3000 — the one canonical name, no alias) **except**
`category === 'safety'`, which is counted and never refused. `threshold` is
`'warn'` at 80 % and `'cap'` at 100 %, returned **once per day and per
threshold** (marker `thresholds.warn` / `thresholds.cap` written in the same
transaction). `db` is structural — `firebase-admin`'s Firestore fits as is.

The gateway calls `reserveGlobalSlot` **after** consent, rate limits and the
org monthly cap, **before** `messages.create()`; a refusal is recorded as
`suppressed / global_cap`. When it is provided, `caps.globalDaily` and the
`global` figure of `incrementCounters` are ignored — the store must stop
incrementing `sms_counters` itself. Without it the v0.1 behaviour is kept.

### Twilio error codes (v0.2.0, TOT-207)

`classifyTwilioError(code)` → `{ action, severity, retry: false }`, for the
API error of `messages.create()` **and** the `ErrorCode` of the status
callback (numbers and numeric strings; anything else is `log_only`).

| Code | `action` | `severity` | Effect at the caller |
| -- | -- | -- | -- |
| 30034 | `alert_fatal` | `fatal` | Sentry `fatal`, immediately |
| 21610 | `opt_out_retroactive` | `info` | `sms_opt_outs/{e164}`, `source: 'twilio_21610'` (the gateway writes it on the API error) |
| 30003 / 30005 | `unreachable_increment` | `warning` | `evidence.unreachableCount++`, `unreachableSuspended` at 3 |
| 30007 | `carrier_filtered` | `warning` | reputation counter, alert above 2 % / 24 h (status callback) |
| 30006 | `mark_landline` | `warning` | `evidence.landline = true` |
| 21211 / 21614 / 21408 | `mark_invalid` | `warning` | `evidence.invalid = true` |
| other | `log_only` | `warning` | log `code` + `moreInfo` |

**Marks refuse at send (v0.2.1)**: a consent document with `evidence.invalid`,
`evidence.landline` or `evidence.unreachableSuspended` is `suppressed` with the
reason `invalid` / `landline` / `unreachable_suspended` — every status, before
counters and Twilio. `invalid` and `landline` refuse every category, `safety`
included (the line cannot receive); `unreachableSuspended` lets `safety` through
(P50 §0 — same exemption as the global daily cap). `unreachableLiftPatch(at)` lifts a
suspension (any inbound SMS from the number, or the admin retry); `invalid` and
`landline` are never lifted. **No raw Twilio text (v0.2.1)**: the message of
`describeTwilioError` — hence `errorMessage` on the result and in
`sms_messages` — is redacted at the source.

`consentEvidencePatch(action, currentEvidence, { code, at })` gives the exact
fields to merge into `sms_consent.evidence` of every consent document of the
number (or `null`), so both consumers write the same thing. A failed send
carries `errorAction`, `errorSeverity` and `retry: false` next to the v0.1
`errorClass`. `redactPhoneNumbers(text)` masks the numbers Twilio quotes in
its messages — logs never carry a phone number.

## Also exported

- `classifyInboundKeyword(body)` — STOP/ARRET/…, START/UNSTOP/OUI/YES,
  HELP/AIDE/INFO, accent- and case-insensitive (webhook TOT-197, Advanced
  Opt-Out list TOT-196).
- `calculateSmsSegments(text)` — GSM-7 / UCS-2 segments (vendored from
  PilotDutySaas `sms-segments.ts`, TOT-240).
- `decideConsent`, `decideFooter`, `applyFooter`, `renderTemplate`,
  `isWithinQuietHours`, `nextQuietHoursEnd`, `classifyTwilioError`,
  `describeTwilioError`, `consentEvidencePatch`, `redactPhoneNumbers`,
  `reserveGlobalDailySlot`, `resolveGlobalDailyCap`.

## Development

```
npm install
npm test            # vitest
npm run test:emulator   # Firestore emulator (firebase CLI + Java): real transactions for the global cap
npm run typecheck
npm run build       # emits dist/ (commit it)
npm run release:check   # build + test + dist must be committed
```

Release: bump `version` in `package.json`, `npm run release:check`, commit,
`git tag vX.Y.Z`, push branch and tag. Consumers bump the `#vX.Y.Z` pin.
