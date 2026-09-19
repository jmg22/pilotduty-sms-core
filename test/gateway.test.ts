import { beforeEach, describe, expect, it } from 'vitest';
import { createSmsGateway, type SendInput, type SmsGateway } from '../src/gateway';
import { STOP_FOOTERS } from '../src/template';
import { FakeTwilio, MemoryStore, silentLogger, twilioError } from './helpers';

const NOW = new Date('2026-09-14T15:00:00Z'); // 11:00 EDT
const ORG = 'orgA';
const TEMPLATES: Record<string, Record<string, string>> = {
  booking_confirmed: {
    en: 'PilotDuty: your booking with {{organization.name}} is confirmed for {{date}}.',
    fr: 'PilotDuty : votre réservation chez {{organization.name}} est confirmée le {{date}}.',
  },
  takeoff: {
    en: 'PilotDuty: {{pilot}} took off from {{airport}} in {{callsign}}.',
  },
};

function baseInput(overrides: Partial<SendInput> = {}): SendInput {
  return {
    to: '+15142905402',
    organizationId: ORG,
    templateId: 'booking_confirmed',
    params: { 'organization.name': 'Totem Aviation', date: 'Sep 20' },
    category: 'transactional',
    locale: 'en',
    ...overrides,
  };
}

describe('createSmsGateway — pipeline (TOT-187)', () => {
  let store: MemoryStore;
  let twilio: FakeTwilio;
  let gateway: SmsGateway;
  let logs: ReturnType<typeof silentLogger>;

  beforeEach(() => {
    store = new MemoryStore();
    twilio = new FakeTwilio();
    logs = silentLogger();
    gateway = createSmsGateway({
      twilio,
      store,
      messagingServiceSid: 'MGtest',
      statusCallbackUrl: 'https://manager.pilotduty.com/api/twilio/status',
      caps: { perOrgMonthly: 5, globalDaily: 10 },
      now: () => NOW,
      templates: (id, locale) => TEMPLATES[id]?.[locale] ?? TEMPLATES[id]?.en ?? null,
      logger: logs.logger,
    });
  });

  it('exposes normalizePhone with the CA default', () => {
    expect(gateway.normalizePhone('5142905402')).toMatchObject({ ok: true, e164: '+15142905402' });
    expect(gateway.normalizePhone('+5142905402').ok).toBe(false);
  });

  describe('step 1 — phone', () => {
    it('suppresses +5142905402 (TOT-275) without calling Twilio or counting', async () => {
      const r = await gateway.send(baseInput({ to: '+5142905402' }));
      expect(r).toMatchObject({ status: 'suppressed', reason: 'invalid_phone', to: '+5142905402' });
      expect(twilio.calls).toHaveLength(0);
      expect(store.orgCounts.size).toBe(0);
      expect(store.messages).toHaveLength(1);
      expect(store.messages[0]).toMatchObject({ status: 'suppressed', suppressReason: 'invalid_phone', to: '+5142905402' });
    });

    it('suppresses " 1" (TOT-195)', async () => {
      const r = await gateway.send(baseInput({ to: ' 1' }));
      expect(r).toMatchObject({ status: 'suppressed', reason: 'invalid_phone' });
    });

    it('normalizes a national number before every other step', async () => {
      const r = await gateway.send(baseInput({ to: '514 290 5402' }));
      expect(r.status).toBe('sent');
      expect(twilio.calls[0]?.to).toBe('+15142905402');
    });
  });

  describe('step 2 — suppression list (TOT-198)', () => {
    it('refuses an opted-out number before consent, caps or Twilio', async () => {
      store.optOuts.set('+15142905402', { keyword: 'STOP', at: NOW, source: 'inbound_keyword' });
      store.consents.set(`+15142905402_${ORG}`, consent('opted_in'));
      const r = await gateway.send(baseInput());
      expect(r).toMatchObject({ status: 'suppressed', reason: 'opted_out' });
      expect(twilio.calls).toHaveLength(0);
      expect(store.orgCounts.size).toBe(0);
      expect(store.messages[0]).toMatchObject({ status: 'suppressed', suppressReason: 'opted_out' });
    });
  });

  describe('step 3 — consent (TOT-193)', () => {
    it('refuses opted_out consent', async () => {
      store.consents.set(`+15142905402_${ORG}`, consent('opted_out'));
      const r = await gateway.send(baseInput({ category: 'safety' }));
      expect(r).toMatchObject({ status: 'suppressed', reason: 'opted_out' });
    });

    it('refuses a reminder to an unknown number without a confirmed booking, allows with one', async () => {
      const refused = await gateway.send(baseInput({ category: 'reminder', timeZone: 'America/Toronto' }));
      expect(refused).toMatchObject({ status: 'suppressed', reason: 'reminder_without_booking' });
      const allowed = await gateway.send(
        baseInput({ category: 'reminder', timeZone: 'America/Toronto', confirmedBookingExists: true }),
      );
      expect(allowed.status).toBe('sent');
    });

    it('opted_in with a recent message sends WITHOUT footer', async () => {
      store.consents.set(`+15142905402_${ORG}`, consent('opted_in'));
      store.lastMessage.set('+15142905402', new Date(NOW.getTime() - 86_400_000));
      const r = await gateway.send(baseInput());
      expect(r).toMatchObject({ status: 'sent', footerApplied: false });
      expect(twilio.calls[0]?.body).toBe('PilotDuty: your booking with Totem Aviation is confirmed for Sep 20.');
    });

    it('attested forces the footer even with a recent message', async () => {
      store.consents.set(`+15142905402_${ORG}`, consent('attested'));
      store.lastMessage.set('+15142905402', new Date(NOW.getTime() - 86_400_000));
      const r = await gateway.send(baseInput());
      expect(r).toMatchObject({ status: 'sent', footerApplied: true });
      expect(twilio.calls[0]?.body.endsWith(STOP_FOOTERS.en!)).toBe(true);
    });
  });

  describe('step 4 — quiet hours (TOT-204)', () => {
    it('defers a reminder at 22:00 recipient time to 08:00, writes nothing, calls nothing', async () => {
      const g = createSmsGateway({
        twilio, store, messagingServiceSid: 'MG', statusCallbackUrl: 'cb',
        caps: { perOrgMonthly: 5, globalDaily: 10 },
        now: () => new Date('2026-09-14T02:00:00Z'), // 22:00 EDT Sep 13
        templates: () => 'body', logger: logs.logger,
      });
      const r = await g.send(baseInput({ category: 'reminder', timeZone: 'America/Toronto', confirmedBookingExists: true }));
      expect(r).toMatchObject({ status: 'deferred', reason: 'quiet_hours' });
      if (r.status === 'deferred') expect(r.deferUntil.toISOString()).toBe('2026-09-14T12:00:00.000Z');
      expect(twilio.calls).toHaveLength(0);
      expect(store.messages).toHaveLength(0);
      expect(store.orgCounts.size).toBe(0);
    });

    it('does not defer safety or transactional at night', async () => {
      const g = createSmsGateway({
        twilio, store, messagingServiceSid: 'MG', statusCallbackUrl: 'cb',
        caps: { perOrgMonthly: 5, globalDaily: 10 },
        now: () => new Date('2026-09-14T02:00:00Z'),
        templates: () => 'body', logger: logs.logger,
      });
      expect((await g.send(baseInput({ category: 'safety', timeZone: 'America/Toronto' }))).status).toBe('sent');
      expect((await g.send(baseInput({ category: 'transactional', timeZone: 'America/Toronto' }))).status).toBe('sent');
    });

    it('sends a reminder with no known time zone and warns', async () => {
      const r = await gateway.send(baseInput({ category: 'reminder', confirmedBookingExists: true }));
      expect(r.status).toBe('sent');
      expect(logs.entries.some((e) => e.level === 'warn' && e.msg.includes('quiet hours skipped'))).toBe(true);
    });
  });

  describe('step 5 — rate limits and caps (TOT-209)', () => {
    it('honours an injected rate limiter', async () => {
      const g = createSmsGateway({
        twilio, store, messagingServiceSid: 'MG', statusCallbackUrl: 'cb',
        caps: { perOrgMonthly: 5, globalDaily: 10 }, now: () => NOW, templates: () => 'body',
        rateLimiter: async () => ({ ok: false, retryAfterSec: 30, blockedBy: 'phone' }),
        logger: logs.logger,
      });
      const r = await g.send(baseInput());
      expect(r).toMatchObject({ status: 'suppressed', reason: 'rate_limited', retryAfterSec: 30 });
      expect(store.orgCounts.size).toBe(0);
    });

    it('suppresses at the org monthly cap', async () => {
      for (let i = 0; i < 5; i++) expect((await gateway.send(baseInput())).status).toBe('sent');
      const r = await gateway.send(baseInput());
      expect(r).toMatchObject({ status: 'suppressed', reason: 'org_cap' });
      expect(twilio.calls).toHaveLength(5);
    });

    it('suppresses at the global daily cap except for safety', async () => {
      const g = createSmsGateway({
        twilio, store, messagingServiceSid: 'MG', statusCallbackUrl: 'cb',
        caps: { perOrgMonthly: 100, globalDaily: 2 }, now: () => NOW, templates: () => 'body', logger: logs.logger,
      });
      expect((await g.send(baseInput({ organizationId: 'o1' }))).status).toBe('sent');
      expect((await g.send(baseInput({ organizationId: 'o2' }))).status).toBe('sent');
      expect(await g.send(baseInput({ organizationId: 'o3' }))).toMatchObject({ status: 'suppressed', reason: 'global_cap' });
      expect((await g.send(baseInput({ organizationId: 'o3', category: 'safety' }))).status).toBe('sent');
      expect(logs.entries.some((e) => e.level === 'error' && e.msg.includes('global daily SMS cap reached'))).toBe(true);
    });
  });

  describe('step 6 — composition and footer (TOT-199, TOT-240)', () => {
    it('first contact (no prior message) appends the footer for an opted_in number', async () => {
      store.consents.set(`+15142905402_${ORG}`, consent('opted_in'));
      const r = await gateway.send(baseInput());
      expect(r).toMatchObject({ status: 'sent', footerApplied: true, encoding: 'GSM-7', segments: 1 });
      expect(twilio.calls[0]?.body).toBe(
        'PilotDuty: your booking with Totem Aviation is confirmed for Sep 20.' + STOP_FOOTERS.en,
      );
    });

    it('30-day window: 29 days ago → no footer, 31 days ago → footer', async () => {
      store.consents.set(`+15142905402_${ORG}`, consent('opted_in'));
      store.lastMessage.set('+15142905402', new Date(NOW.getTime() - 29 * 86_400_000));
      expect(await gateway.send(baseInput())).toMatchObject({ footerApplied: false });
      store.lastMessage.set('+15142905402', new Date(NOW.getTime() - 31 * 86_400_000));
      expect(await gateway.send(baseInput())).toMatchObject({ footerApplied: true });
    });

    it('safety always carries the footer', async () => {
      store.consents.set(`+15142905402_${ORG}`, consent('opted_in'));
      store.lastMessage.set('+15142905402', new Date(NOW.getTime() - 3600_000));
      const r = await gateway.send(baseInput({ templateId: 'takeoff', category: 'safety', params: { pilot: 'Jean', airport: 'CYHU', callsign: 'C-GXYZ' } }));
      expect(r).toMatchObject({ footerApplied: true });
    });

    it('uses the French footer for fr-CA — GSM-7, one segment, no warning (P8, v0.1.1)', async () => {
      const r = await gateway.send(baseInput({ locale: 'fr-CA' }));
      expect(r).toMatchObject({ status: 'sent', encoding: 'GSM-7', segments: 1 });
      expect(twilio.calls[0]?.body.endsWith(STOP_FOOTERS.fr!)).toBe(true);
      expect(logs.entries.some((e) => e.msg === 'footer_pushed_second_segment')).toBe(false);
    });

    it('accepts a pre-composed body and still applies the footer', async () => {
      const r = await gateway.send(baseInput({ templateId: 'custom', body: 'PilotDuty: hello.' }));
      expect(r.status).toBe('sent');
      expect(twilio.calls[0]?.body).toBe('PilotDuty: hello.' + STOP_FOOTERS.en);
    });

    it('throws on an unknown template (configuration error, not a suppression)', async () => {
      await expect(gateway.send(baseInput({ templateId: 'nope' }))).rejects.toThrow(/unknown template/);
    });

    it('throws when the body exceeds 1600 characters', async () => {
      await expect(gateway.send(baseInput({ body: 'x'.repeat(1601) }))).rejects.toThrow(/1600/);
    });
  });

  describe('steps 7–8 — Twilio call, record, errors (TOT-205, TOT-207)', () => {
    it('calls messages.create with messagingServiceSid + statusCallback and records the sid', async () => {
      const r = await gateway.send(baseInput({ idempotencyKey: 'k1' }));
      expect(twilio.calls[0]).toEqual({
        messagingServiceSid: 'MGtest',
        statusCallback: 'https://manager.pilotduty.com/api/twilio/status',
        to: '+15142905402',
        body: expect.stringContaining('PilotDuty: your booking'),
      });
      expect(r).toMatchObject({ status: 'sent', sid: 'SM0001', messageId: 'SM0001', sender: '+18005550100' });
      expect(store.messages[0]).toMatchObject({
        id: 'SM0001', to: '+15142905402', organizationId: ORG, templateId: 'booking_confirmed',
        category: 'transactional', locale: 'en', status: 'queued', sender: '+18005550100',
        segments: 1, encoding: 'GSM-7', footerApplied: true, idempotencyKey: 'k1', sentAt: NOW,
      });
      expect((twilio.calls[0] as unknown as Record<string, unknown>).from).toBeUndefined();
    });

    it('21610 → failed, retroactive opt-out written, next send suppressed without Twilio', async () => {
      twilio.nextError = twilioError(21610, 'unsubscribed recipient');
      const r = await gateway.send(baseInput());
      expect(r).toMatchObject({ status: 'failed', errorCode: 21610, errorClass: 'opted_out' });
      expect(store.optOuts.get('+15142905402')).toMatchObject({ keyword: '21610', source: 'twilio_error', at: NOW });
      expect(store.messages[0]).toMatchObject({ status: 'failed', errorCode: 21610 });
      const again = await gateway.send(baseInput());
      expect(again).toMatchObject({ status: 'suppressed', reason: 'opted_out' });
      expect(twilio.calls).toHaveLength(1);
    });

    it('21408 → failed/invalid_number with code and moreInfo recorded, no opt-out', async () => {
      twilio.nextError = twilioError(21408);
      const r = await gateway.send(baseInput());
      expect(r).toMatchObject({ status: 'failed', errorCode: 21408, errorClass: 'invalid_number' });
      if (r.status === 'failed') expect(r.moreInfo).toContain('21408');
      expect(store.optOuts.size).toBe(0);
      expect(logs.entries.find((e) => e.msg === 'twilio send failed')?.ctx).toMatchObject({ code: 21408, moreInfo: expect.stringContaining('21408') });
    });

    it('30034 is logged at error level', async () => {
      twilio.nextError = twilioError(30034);
      const r = await gateway.send(baseInput());
      expect(r).toMatchObject({ status: 'failed', errorClass: 'unregistered_sender' });
      expect(logs.entries.some((e) => e.level === 'error' && e.msg.includes('30034'))).toBe(true);
    });

    it('never throws on a non-Twilio rejection', async () => {
      twilio.nextError = new Error('network down');
      const r = await gateway.send(baseInput());
      expect(r).toMatchObject({ status: 'failed', errorClass: 'other', errorMessage: 'network down' });
    });

    it('idempotency key already seen → duplicate, nothing else touched', async () => {
      store.idempotencyKeys.add('dup');
      const r = await gateway.send(baseInput({ idempotencyKey: 'dup' }));
      expect(r).toMatchObject({ status: 'suppressed', reason: 'duplicate' });
      expect(store.messages).toHaveLength(0);
      expect(twilio.calls).toHaveLength(0);
    });
  });

  it('requires a messagingServiceSid', () => {
    expect(() =>
      createSmsGateway({ twilio, store, messagingServiceSid: '', statusCallbackUrl: 'cb', caps: { perOrgMonthly: 1, globalDaily: 1 } }),
    ).toThrow(/messagingServiceSid/);
  });
});

function consent(status: 'opted_in' | 'attested' | 'opted_out' | 'unknown') {
  return {
    phone: '+15142905402',
    organizationId: ORG,
    status,
    source: 'booking_widget' as const,
    collectedAt: NOW,
    collectedBy: 'self',
    textVersion: '2026-09-v1',
  };
}
