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
"@pilotduty/sms-core": "github:jmg22/pilotduty-sms-core#v0.1.0"
```

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
  case 'suppressed': // result.reason: invalid_phone | opted_out | reminder_without_booking | rate_limited | org_cap | global_cap | duplicate
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
| 3 | Consent table (`opted_in` / `attested` / `unknown` / `opted_out`) | `suppressed / opted_out` or `reminder_without_booking` | TOT-193 |
| 4 | Quiet hours 21:00–08:00 recipient local, `reminder` only | `deferred / quiet_hours` + `deferUntil` | TOT-204 |
| 5 | Injected rate limiter, then org monthly cap and global daily cap (`safety` exempt from global) | `suppressed / rate_limited`, `org_cap`, `global_cap` | TOT-209 |
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

## Also exported

- `classifyInboundKeyword(body)` — STOP/ARRET/…, START/UNSTOP/OUI/YES,
  HELP/AIDE/INFO, accent- and case-insensitive (webhook TOT-197, Advanced
  Opt-Out list TOT-196).
- `calculateSmsSegments(text)` — GSM-7 / UCS-2 segments (vendored from
  PilotDutySaas `sms-segments.ts`, TOT-240).
- `decideConsent`, `decideFooter`, `applyFooter`, `renderTemplate`,
  `isWithinQuietHours`, `nextQuietHoursEnd`, `classifyTwilioError`,
  `describeTwilioError`.

## Development

```
npm install
npm test            # vitest
npm run typecheck
npm run build       # emits dist/ (commit it)
npm run release:check   # build + test + dist must be committed
```

Release: bump `version` in `package.json`, `npm run release:check`, commit,
`git tag vX.Y.Z`, push branch and tag. Consumers bump the `#vX.Y.Z` pin.
