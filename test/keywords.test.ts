import { describe, expect, it } from 'vitest';
import { classifyInboundKeyword, normalizeKeyword } from '../src/keywords';

describe('classifyInboundKeyword — TOT-196 list, TOT-197 matching', () => {
  it('matches opt-out keywords case- and accent-insensitively', () => {
    for (const body of ['STOP', 'stop', 'Stop', 'ARRÊT', 'arrêt', 'Arret', 'UNSUBSCRIBE', 'cancel', 'End', 'quit', ' stop ', 'STOP.', '"Stop"']) {
      expect(classifyInboundKeyword(body)?.kind, body).toBe('opt_out');
    }
    expect(classifyInboundKeyword('ARRÊT')?.keyword).toBe('ARRET');
  });

  it('matches opt-in and help keywords', () => {
    for (const body of ['START', 'unstop', 'Oui', 'YES']) {
      expect(classifyInboundKeyword(body)?.kind, body).toBe('opt_in');
    }
    for (const body of ['HELP', 'aide', 'Info']) {
      expect(classifyInboundKeyword(body)?.kind, body).toBe('help');
    }
  });

  it('does not match a sentence that merely contains a keyword', () => {
    expect(classifyInboundKeyword('please stop texting me')).toBeNull();
    expect(classifyInboundKeyword('stop now')).toBeNull();
    expect(classifyInboundKeyword('Merci')).toBeNull();
    expect(classifyInboundKeyword('')).toBeNull();
    expect(classifyInboundKeyword(undefined)).toBeNull();
  });

  it('normalizeKeyword strips diacritics and surrounding punctuation', () => {
    expect(normalizeKeyword('  «Arrêt!»  ')).toBe('ARRET');
  });
});
