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
