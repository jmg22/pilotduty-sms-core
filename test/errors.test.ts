import { describe, expect, it } from 'vitest';
import {
  classifyTwilioError,
  consentEvidencePatch,
  describeTwilioError,
  isPermanentTwilioError,
  parseTwilioErrorCode,
  redactPhoneNumbers,
  TWILIO_ERROR_ACTIONS,
  TWILIO_ERROR_SEVERITIES,
  twilioErrorClassOf,
  UNREACHABLE_SUSPEND_AFTER,
  type TwilioErrorAction,
  type TwilioErrorSeverity,
} from '../src/errors';

/** The TOT-207 table, restated independently of the implementation. */
const TABLE: ReadonlyArray<[number, TwilioErrorAction, TwilioErrorSeverity]> = [
  [30034, 'alert_fatal', 'fatal'],
  [21610, 'opt_out_retroactive', 'info'],
  [30003, 'unreachable_increment', 'warning'],
  [30005, 'unreachable_increment', 'warning'],
  [30007, 'carrier_filtered', 'warning'],
  [30006, 'mark_landline', 'warning'],
  [21211, 'mark_invalid', 'warning'],
  [21614, 'mark_invalid', 'warning'],
  [21408, 'mark_invalid', 'warning'],
];

describe('classifyTwilioError — TOT-207 table (v0.2.0)', () => {
  it.each(TABLE)('%i → %s / %s, never retried', (code, action, severity) => {
    expect(classifyTwilioError(code)).toEqual({ action, severity, retry: false });
  });

  it.each(TABLE)('%i as the string of the status callback → same result', (code, action, severity) => {
    expect(classifyTwilioError(String(code))).toEqual({ action, severity, retry: false });
    expect(classifyTwilioError(` ${code} `)).toEqual({ action, severity, retry: false });
  });

  it('the table has exactly the nine documented codes', () => {
    expect(Object.keys(TWILIO_ERROR_ACTIONS).map(Number).sort()).toEqual(TABLE.map(([c]) => c).sort());
  });

  it.each([
    30001, 30002, 30004, 30008, 30010, 30032, 30033, 30035, 21212, 21606, 21609, 21611, 21612, 21617, 20003, 20429, 63038, 1, 99999,
  ])('other code %i → log_only, warning, no retry', (code) => {
    expect(classifyTwilioError(code)).toEqual({ action: 'log_only', severity: 'warning', retry: false });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['text', 'abc'],
    ['code with a suffix', '30034abc'],
    ['signed string', '-30034'],
    ['decimal string', '30034.0'],
    ['hex string', '0x7552'],
    ['decimal number', 30034.5],
    ['negative number', -30034],
    ['zero', 0],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['boolean', true],
    ['object', { code: 30034 }],
    ['array', [30034]],
    ['too long', '3003400000000'],
  ])('non-numeric / malformed (%s) → log_only', (_label, code) => {
    expect(classifyTwilioError(code)).toEqual({ action: 'log_only', severity: 'warning', retry: false });
  });

  it('never says retry, for any action', () => {
    for (let code = 20000; code <= 31000; code += 1) {
      expect(classifyTwilioError(code).retry).toBe(false);
    }
  });

  it('returns a fresh object each time (callers may not corrupt the table)', () => {
    const a = classifyTwilioError(30034);
    (a as { action: string }).action = 'log_only';
    expect(classifyTwilioError(30034).action).toBe('alert_fatal');
    expect(Object.isFrozen(TWILIO_ERROR_ACTIONS)).toBe(true);
    expect(Object.isFrozen(TWILIO_ERROR_SEVERITIES)).toBe(true);
  });

  it('parseTwilioErrorCode keeps plain positive integers only', () => {
    expect(parseTwilioErrorCode(21610)).toBe(21610);
    expect(parseTwilioErrorCode('21610')).toBe(21610);
    expect(parseTwilioErrorCode('x')).toBeUndefined();
    expect(parseTwilioErrorCode(0)).toBeUndefined();
    expect(parseTwilioErrorCode('0')).toBeUndefined();
  });
});

describe('describeTwilioError', () => {
  it('extracts code / moreInfo from a Twilio RestException-like error and classifies it', () => {
    const info = describeTwilioError({
      status: 400,
      code: 21408,
      message: 'Permission to send an SMS has not been enabled for the region indicated by the To number',
      moreInfo: 'https://www.twilio.com/docs/errors/21408',
    });
    expect(info).toMatchObject({ code: 21408, status: 400, class: 'invalid_number', action: 'mark_invalid', severity: 'warning', retry: false });
    expect(info.moreInfo).toContain('21408');
    expect(describeTwilioError(new Error('boom'))).toMatchObject({ class: 'other', action: 'log_only', message: 'boom' });
    expect(describeTwilioError({ code: '21610', message: 'x' })).toMatchObject({ code: 21610, action: 'opt_out_retroactive' });
    expect(describeTwilioError(null)).toMatchObject({ action: 'log_only', code: undefined });
  });

  it('keeps the v0.1 class vocabulary, one class per action', () => {
    expect(twilioErrorClassOf('alert_fatal')).toBe('unregistered_sender');
    expect(twilioErrorClassOf('opt_out_retroactive')).toBe('opted_out');
    expect(twilioErrorClassOf('unreachable_increment')).toBe('unreachable');
    expect(twilioErrorClassOf('carrier_filtered')).toBe('carrier_filtered');
    expect(twilioErrorClassOf('mark_landline')).toBe('landline');
    expect(twilioErrorClassOf('mark_invalid')).toBe('invalid_number');
    expect(twilioErrorClassOf('log_only')).toBe('other');
  });

  it('knows which classes can never succeed on a retry', () => {
    expect(isPermanentTwilioError('opted_out')).toBe(true);
    expect(isPermanentTwilioError('invalid_number')).toBe(true);
    expect(isPermanentTwilioError('landline')).toBe(true);
    expect(isPermanentTwilioError('unregistered_sender')).toBe(true);
    expect(isPermanentTwilioError('unreachable')).toBe(false);
    expect(isPermanentTwilioError('carrier_filtered')).toBe(false);
    expect(isPermanentTwilioError('other')).toBe(false);
  });
});

describe('redactPhoneNumbers', () => {
  it('masks any phone number Twilio quotes, keeps codes and URLs', () => {
    expect(redactPhoneNumbers("The 'To' number +15142905402 is not a valid phone number")).toBe(
      "The 'To' number [redacted-number] is not a valid phone number",
    );
    expect(redactPhoneNumbers('to (514) 290-5402 and 514 290 5402')).not.toMatch(/\d{3}/);
    expect(redactPhoneNumbers('see https://www.twilio.com/docs/errors/21408 (code 21408)')).toBe(
      'see https://www.twilio.com/docs/errors/21408 (code 21408)',
    );
  });
});

describe('consentEvidencePatch — effects on sms_consent.evidence', () => {
  const at = new Date('2026-09-21T16:00:00Z');

  it('unreachable_increment counts and suspends at 3', () => {
    expect(UNREACHABLE_SUSPEND_AFTER).toBe(3);
    expect(consentEvidencePatch('unreachable_increment', null, { code: 30003, at })).toEqual({
      unreachableCount: 1,
      lastTwilioErrorCode: 30003,
      lastTwilioErrorAt: at,
    });
    expect(consentEvidencePatch('unreachable_increment', { unreachableCount: 1 }, { code: 30005, at })).toEqual({
      unreachableCount: 2,
      lastTwilioErrorCode: 30005,
      lastTwilioErrorAt: at,
    });
    expect(consentEvidencePatch('unreachable_increment', { unreachableCount: 2 }, { code: 30003, at })).toMatchObject({
      unreachableCount: 3,
      unreachableSuspended: true,
    });
    expect(consentEvidencePatch('unreachable_increment', { unreachableCount: 7 }, { code: 30003, at })).toMatchObject({
      unreachableCount: 8,
      unreachableSuspended: true,
    });
  });

  it('survives a corrupted counter', () => {
    for (const bad of [Number.NaN, -4, 'x' as unknown as number, undefined]) {
      expect(consentEvidencePatch('unreachable_increment', { unreachableCount: bad }, { at })?.unreachableCount).toBe(1);
    }
  });

  it('marks landline and invalid', () => {
    expect(consentEvidencePatch('mark_landline', null, { code: 30006, at })).toEqual({ landline: true, lastTwilioErrorCode: 30006, lastTwilioErrorAt: at });
    expect(consentEvidencePatch('mark_invalid', null, { code: 21408, at })).toEqual({ invalid: true, lastTwilioErrorCode: 21408, lastTwilioErrorAt: at });
  });

  it('has no per-number effect for the other actions', () => {
    for (const action of ['alert_fatal', 'opt_out_retroactive', 'carrier_filtered', 'log_only'] as const) {
      expect(consentEvidencePatch(action, { unreachableCount: 2 }, { code: 1, at })).toBeNull();
    }
  });
});
