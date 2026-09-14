/**
 * Inbound keywords — the single list shared by the inbound webhook
 * (PilotDutySaas `/api/twilio/inbound`, TOT-197) and Twilio's Advanced
 * Opt-Out configuration (TOT-196). Matching is case- and accent-insensitive
 * (`Arrêt`, `ARRET`, `arret` are the same keyword).
 */

export const OPT_OUT_KEYWORDS = [
  'STOP',
  'ARRET',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
] as const;

export const OPT_IN_KEYWORDS = ['START', 'UNSTOP', 'OUI', 'YES'] as const;

export const HELP_KEYWORDS = ['HELP', 'AIDE', 'INFO'] as const;

export type InboundKeywordKind = 'opt_out' | 'opt_in' | 'help';

export interface InboundKeywordMatch {
  kind: InboundKeywordKind;
  /** Canonical keyword (upper-case, accents stripped), e.g. `ARRET`. */
  keyword: string;
}

/** Upper-case, accents stripped, surrounding whitespace/punctuation removed. */
export function normalizeKeyword(body: string): string {
  return body
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '')
    .trim();
}

/**
 * Classify an inbound SMS body. Only a message that IS the keyword (after
 * normalization) matches — "STOP" or "stop." do, "please stop" does not, the
 * same rule Twilio applies. Returns `null` for anything else.
 */
export function classifyInboundKeyword(
  body: string | null | undefined,
): InboundKeywordMatch | null {
  if (!body) return null;
  const keyword = normalizeKeyword(body);
  if (!keyword) return null;
  if ((OPT_OUT_KEYWORDS as readonly string[]).includes(keyword)) {
    return { kind: 'opt_out', keyword };
  }
  if ((OPT_IN_KEYWORDS as readonly string[]).includes(keyword)) {
    return { kind: 'opt_in', keyword };
  }
  if ((HELP_KEYWORDS as readonly string[]).includes(keyword)) {
    return { kind: 'help', keyword };
  }
  return null;
}
