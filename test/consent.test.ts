import { describe, expect, it } from 'vitest';
import { decideConsent } from '../src/consent';
import type { SmsCategory } from '../src/types';

const CATEGORIES: SmsCategory[] = ['transactional', 'safety', 'reminder'];

describe('decideConsent — TOT-193 table', () => {
  it('opted_out refuses every category', () => {
    for (const category of CATEGORIES) {
      expect(decideConsent({ status: 'opted_out' }, category)).toMatchObject({
        allow: false,
        reason: 'opted_out',
      });
    }
  });

  it('opted_in sends every category without forcing the footer', () => {
    for (const category of CATEGORIES) {
      expect(decideConsent({ status: 'opted_in' }, category)).toEqual({
        allow: true,
        effectiveStatus: 'opted_in',
        forceFooter: false,
      });
    }
  });

  it('attested sends every category with the footer forced (never promoted)', () => {
    for (const category of CATEGORIES) {
      expect(decideConsent({ status: 'attested' }, category)).toEqual({
        allow: true,
        effectiveStatus: 'attested',
        forceFooter: true,
      });
    }
  });

  it('unknown / absent sends transactional and safety with footer forced', () => {
    for (const consent of [null, undefined, { status: 'unknown' as const }]) {
      for (const category of ['transactional', 'safety'] as const) {
        expect(decideConsent(consent, category)).toEqual({
          allow: true,
          effectiveStatus: 'unknown',
          forceFooter: true,
        });
      }
    }
  });

  it('unknown / absent + reminder requires a confirmed booking', () => {
    expect(decideConsent(null, 'reminder')).toMatchObject({
      allow: false,
      reason: 'reminder_without_booking',
    });
    expect(decideConsent(null, 'reminder', { confirmedBookingExists: false })).toMatchObject({
      allow: false,
    });
    expect(decideConsent(null, 'reminder', { confirmedBookingExists: true })).toEqual({
      allow: true,
      effectiveStatus: 'unknown',
      forceFooter: true,
    });
  });
});

describe('decideConsent — delivery marks refuse at send (TOT-207, P49 §5, v0.2.1)', () => {
  const STATUSES = ['opted_in', 'attested', 'unknown'] as const;

  it.each([
    ['invalid', { invalid: true }],
    ['landline', { landline: true }],
  ] as const)('%s refuses every status and EVERY category, safety included — the line cannot receive (P50 §0)', (reason, evidence) => {
    for (const status of STATUSES) {
      for (const category of CATEGORIES) {
        expect(decideConsent({ status, evidence }, category, { confirmedBookingExists: true })).toEqual({
          allow: false,
          reason,
          effectiveStatus: status,
          forceFooter: true,
        });
      }
    }
  });

  it('unreachable_suspended refuses transactional and reminder, but `safety` goes through (P50 §0 — a phone that was off three times is not an invalid number)', () => {
    const evidence = { unreachableSuspended: true, unreachableCount: 3 };
    for (const status of STATUSES) {
      for (const category of ['transactional', 'reminder'] as const) {
        expect(decideConsent({ status, evidence }, category, { confirmedBookingExists: true })).toMatchObject({
          allow: false,
          reason: 'unreachable_suspended',
        });
      }
      // The overdue alert must still go out — same exemption as the global daily cap.
      expect(decideConsent({ status, evidence }, 'safety')).toEqual({
        allow: true,
        effectiveStatus: status,
        forceFooter: status !== 'opted_in',
      });
    }
  });

  it('a suspended number that is ALSO invalid or landline stays refused, safety included — the stronger mark wins', () => {
    for (const [reason, extra] of [['invalid', { invalid: true }], ['landline', { landline: true }]] as const) {
      expect(decideConsent({ status: 'attested', evidence: { unreachableSuspended: true, ...extra } }, 'safety')).toMatchObject({
        allow: false,
        reason,
      });
    }
  });

  it('opted_out wins over a mark; invalid > landline > unreachable_suspended', () => {
    expect(decideConsent({ status: 'opted_out', evidence: { invalid: true } }, 'safety').reason).toBe('opted_out');
    expect(decideConsent({ status: 'attested', evidence: { invalid: true, landline: true, unreachableSuspended: true } }, 'safety').reason).toBe('invalid');
    expect(decideConsent({ status: 'attested', evidence: { landline: true, unreachableSuspended: true } }, 'safety').reason).toBe('landline');
  });

  it('only the boolean marks refuse: a counter below (or even at) the threshold without the mark, a lifted suspension, other evidence → send', () => {
    for (const evidence of [
      { unreachableCount: 2 },
      { unreachableCount: 3 },
      { unreachableCount: 0, unreachableSuspended: false, unreachableLiftedAt: new Date() },
      { invalid: false, landline: false },
      { note: 'x', lastTwilioErrorCode: 30007 },
      {},
      undefined,
    ]) {
      expect(decideConsent({ status: 'attested', evidence }, 'transactional').allow).toBe(true);
    }
    expect(decideConsent({ status: 'attested', evidence: { invalid: 'true' as unknown as boolean } }, 'transactional').allow).toBe(true);
  });

  it('no consent record → no mark → the TOT-193 table applies unchanged', () => {
    expect(decideConsent(null, 'safety')).toEqual({ allow: true, effectiveStatus: 'unknown', forceFooter: true });
  });
});
