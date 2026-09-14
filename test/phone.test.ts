import { describe, expect, it } from 'vitest';
import { normalizePhone, toE164, isSmsCapablePhone } from '../src/phone';

describe('normalizePhone — TOT-275 / TOT-195 non-regression', () => {
  it('rejects +5142905402 (valid Peruvian landline, a Montréal number missing its 1)', () => {
    const r = normalizePhone('+5142905402', 'CA');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('not_mobile');
      expect(r.country).toBe('PE');
    }
  });

  it('normalizes 5142905402 → +15142905402 with defaultCountry=CA', () => {
    expect(normalizePhone('5142905402', 'CA')).toMatchObject({
      ok: true,
      e164: '+15142905402',
      country: 'CA',
    });
  });

  it('defaults to CA when no country is given', () => {
    expect(normalizePhone('5142905402')).toMatchObject({ ok: true, e164: '+15142905402' });
  });

  it('also accepts a 514 number typed with defaultCountry=US (shared NANP plan)', () => {
    expect(normalizePhone('5142905402', 'US')).toMatchObject({ ok: true, e164: '+15142905402' });
  });

  it('rejects " 1" (TOT-195 iOS case) as unparseable', () => {
    expect(normalizePhone(' 1', 'CA')).toEqual({ ok: false, reason: 'unparseable', raw: '1' });
  });

  it('rejects empty / whitespace input', () => {
    expect(normalizePhone('', 'CA')).toEqual({ ok: false, reason: 'empty', raw: '' });
    expect(normalizePhone('   ', 'CA')).toEqual({ ok: false, reason: 'empty', raw: '' });
  });

  it('accepts national formats with punctuation', () => {
    for (const raw of ['(514) 290-5402', '514.290.5402', '1 514 290 5402', '+1 514 290 5402']) {
      expect(normalizePhone(raw, 'CA')).toMatchObject({ ok: true, e164: '+15142905402' });
    }
  });

  it('ignores defaultCountry when the number carries its own country code', () => {
    expect(normalizePhone('+33612345678', 'CA')).toMatchObject({
      ok: true,
      e164: '+33612345678',
      country: 'FR',
      type: 'MOBILE',
    });
  });

  it('rejects a valid French landline (cannot receive SMS)', () => {
    const r = normalizePhone('+33123456789', 'CA');
    expect(r).toMatchObject({ ok: false, reason: 'not_mobile', country: 'FR', type: 'FIXED_LINE' });
  });

  it('rejects a number that is invalid for its country', () => {
    // +1 514 with too few digits
    const r = normalizePhone('+1514290', 'CA');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['invalid_for_country', 'unparseable']).toContain(r.reason);
  });

  it('accepts mobiles from served countries (UK, AU, CH, DE)', () => {
    expect(normalizePhone('+447911123456')).toMatchObject({ ok: true, type: 'MOBILE' });
    expect(normalizePhone('+61412345678')).toMatchObject({ ok: true, country: 'AU', type: 'MOBILE' });
    expect(normalizePhone('+41791234567')).toMatchObject({ ok: true, country: 'CH', type: 'MOBILE' });
    expect(normalizePhone('+4915112345678')).toMatchObject({ ok: true, country: 'DE', type: 'MOBILE' });
  });

  it('never throws on garbage', () => {
    for (const raw of ['abc', '+', '++1', '🙂', '+999999999999999999']) {
      expect(() => normalizePhone(raw)).not.toThrow();
      expect(normalizePhone(raw).ok).toBe(false);
    }
  });

  it('helpers agree with normalizePhone', () => {
    expect(toE164('5142905402')).toBe('+15142905402');
    expect(toE164('+5142905402')).toBeNull();
    expect(isSmsCapablePhone('+15142905402')).toBe(true);
    expect(isSmsCapablePhone('+5142905402')).toBe(false);
  });
});
