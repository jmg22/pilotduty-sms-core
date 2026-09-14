import { describe, expect, it } from 'vitest';
import {
  isValidTimeZone,
  isWithinQuietHours,
  localHour,
  nextQuietHoursEnd,
} from '../src/quiet-hours';

const TZ = 'America/Toronto';

describe('quiet hours — TOT-204 (21:00–08:00 recipient local time)', () => {
  it('reads the local hour in the recipient zone', () => {
    // 2026-09-14T01:30Z = 21:30 EDT the day before
    expect(localHour(new Date('2026-09-14T01:30:00Z'), TZ)).toBe(21);
    expect(localHour(new Date('2026-09-14T12:00:00Z'), TZ)).toBe(8);
    expect(localHour(new Date('2026-09-14T04:00:00Z'), TZ)).toBe(0);
  });

  it('flags 21:00 → 07:59 as quiet, 08:00 → 20:59 as open', () => {
    expect(isWithinQuietHours(new Date('2026-09-14T01:00:00Z'), TZ)).toBe(true); // 21:00 EDT
    expect(isWithinQuietHours(new Date('2026-09-14T11:59:00Z'), TZ)).toBe(true); // 07:59 EDT
    expect(isWithinQuietHours(new Date('2026-09-14T12:00:00Z'), TZ)).toBe(false); // 08:00 EDT
    expect(isWithinQuietHours(new Date('2026-09-14T00:59:00Z'), TZ)).toBe(false); // 20:59 EDT
  });

  it('defers an evening reminder to 08:00 next morning, and an early one to 08:00 same day', () => {
    const evening = new Date('2026-09-14T01:30:00Z'); // 21:30 EDT Sep 13
    expect(nextQuietHoursEnd(evening, TZ).toISOString()).toBe('2026-09-14T12:00:00.000Z'); // 08:00 EDT Sep 14
    const early = new Date('2026-09-14T09:15:00Z'); // 05:15 EDT Sep 14
    expect(nextQuietHoursEnd(early, TZ).toISOString()).toBe('2026-09-14T12:00:00.000Z');
  });

  it('handles a DST boundary (Europe/Paris, last Sunday of October 2026)', () => {
    // 2026-10-24T22:30Z = 00:30 CEST Oct 25; DST ends at 03:00 CEST → 02:00 CET.
    const night = new Date('2026-10-24T22:30:00Z');
    // 08:00 CET on Oct 25 = 07:00Z
    expect(nextQuietHoursEnd(night, 'Europe/Paris').toISOString()).toBe('2026-10-25T07:00:00.000Z');
  });

  it('validates IANA zones', () => {
    expect(isValidTimeZone('America/Toronto')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});
