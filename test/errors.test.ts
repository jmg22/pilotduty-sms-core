import { describe, expect, it } from 'vitest';
import { classifyTwilioError, describeTwilioError, isPermanentTwilioError } from '../src/errors';

describe('classifyTwilioError — TOT-207', () => {
  it('maps the documented codes', () => {
    expect(classifyTwilioError(30034)).toBe('unregistered_sender');
    expect(classifyTwilioError(21610)).toBe('opted_out');
    expect(classifyTwilioError(30003)).toBe('unreachable');
    expect(classifyTwilioError(30005)).toBe('unreachable');
    expect(classifyTwilioError(30007)).toBe('carrier_filtered');
    expect(classifyTwilioError(30006)).toBe('landline');
    expect(classifyTwilioError(21211)).toBe('invalid_number');
    expect(classifyTwilioError(21614)).toBe('invalid_number');
    expect(classifyTwilioError(21408)).toBe('invalid_number');
    expect(classifyTwilioError(30008)).toBe('other');
    expect(classifyTwilioError(undefined)).toBe('other');
  });

  it('extracts code / moreInfo from a Twilio RestException-like error', () => {
    const info = describeTwilioError({
      status: 400,
      code: 21408,
      message: 'Permission to send an SMS has not been enabled for the region indicated by the To number',
      moreInfo: 'https://www.twilio.com/docs/errors/21408',
    });
    expect(info).toMatchObject({ code: 21408, status: 400, class: 'invalid_number' });
    expect(info.moreInfo).toContain('21408');
    expect(describeTwilioError(new Error('boom'))).toMatchObject({ class: 'other', message: 'boom' });
    expect(describeTwilioError({ code: '21610', message: 'x' }).code).toBe(21610);
  });

  it('knows which classes must never be retried', () => {
    expect(isPermanentTwilioError('opted_out')).toBe(true);
    expect(isPermanentTwilioError('invalid_number')).toBe(true);
    expect(isPermanentTwilioError('landline')).toBe(true);
    expect(isPermanentTwilioError('unreachable')).toBe(false);
    expect(isPermanentTwilioError('carrier_filtered')).toBe(false);
  });
});
