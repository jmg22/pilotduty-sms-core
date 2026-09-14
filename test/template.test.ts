import { describe, expect, it } from 'vitest';
import { applyFooter, decideFooter, footerFor, renderTemplate, STOP_FOOTERS } from '../src/template';
import { calculateSmsSegments } from '../src/segments';

describe('renderTemplate', () => {
  it('replaces dotted placeholders and reports missing ones', () => {
    const r = renderTemplate('PilotDuty: your flight with {{organization.name}} is {{date}} at {{ time }}.', {
      'organization.name': 'Totem Aviation',
      date: 'Sep 12',
    });
    expect(r.body).toBe('PilotDuty: your flight with Totem Aviation is Sep 12 at .');
    expect(r.missing).toEqual(['time']);
  });
});

describe('decideFooter — TOT-199', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it('first contact: no previous message, or last one 30+ days ago', () => {
    expect(decideFooter({ category: 'transactional', consentStatus: 'opted_in', lastMessageAt: null, now })).toEqual({
      needed: true,
      reasons: ['first_contact'],
    });
    expect(decideFooter({ category: 'transactional', consentStatus: 'opted_in', lastMessageAt: days(30), now }).reasons).toContain('first_contact');
    expect(decideFooter({ category: 'transactional', consentStatus: 'opted_in', lastMessageAt: days(29), now })).toEqual({
      needed: false,
      reasons: [],
    });
  });

  it('safety always gets the footer', () => {
    expect(decideFooter({ category: 'safety', consentStatus: 'opted_in', lastMessageAt: days(1), now }).reasons).toEqual(['safety']);
  });

  it('consent ≠ opted_in forces the footer', () => {
    for (const consentStatus of ['attested', 'unknown'] as const) {
      expect(decideFooter({ category: 'transactional', consentStatus, lastMessageAt: days(1), now }).reasons).toEqual(['consent_not_opted_in']);
    }
  });
});

describe('applyFooter', () => {
  it('appends the localized footer once and measures segments', () => {
    const body = 'PilotDuty: your flight with Totem Aviation is Sep 12 at 14:30, aircraft C-GXYZ.';
    const en = applyFooter(body, footerFor('en'), true);
    expect(en.body).toBe(body + STOP_FOOTERS.en);
    expect(en.footerApplied).toBe(true);
    expect(en.encoding).toBe('GSM-7');
    expect(en.segments).toBe(1);
    // idempotent
    const again = applyFooter(en.body, footerFor('en'), true);
    expect(again.body).toBe(en.body);
  });

  it('leaves the body alone when not needed', () => {
    const r = applyFooter('Hello', footerFor('en'), false);
    expect(r).toMatchObject({ body: 'Hello', footerApplied: false, segments: 1 });
  });

  it('reports when the footer pushes the message to a second segment', () => {
    const body = 'x'.repeat(150);
    const r = applyFooter(body, footerFor('en'), true);
    expect(r.segmentsBeforeFooter).toBe(1);
    expect(r.segments).toBe(2);
    expect(r.footerPushedSegment).toBe(true);
  });

  it('French footer flips to UCS-2 because of "ê" (flagged to the pilot)', () => {
    expect(calculateSmsSegments(STOP_FOOTERS.fr!).encoding).toBe('UCS-2');
    expect(footerFor('fr-CA')).toBe(STOP_FOOTERS.fr);
    expect(footerFor('de')).toBe(STOP_FOOTERS.en);
  });
});
