/**
 * Inbound keywords — the single list shared by the inbound webhook
 * (PilotDutySaas `/api/twilio/inbound`, TOT-197) and Twilio's Advanced
 * Opt-Out configuration (TOT-196). Matching is case- and accent-insensitive
 * (`Arrêt`, `ARRET`, `arret` are the same keyword).
 */
export declare const OPT_OUT_KEYWORDS: readonly ["STOP", "ARRET", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
export declare const OPT_IN_KEYWORDS: readonly ["START", "UNSTOP", "OUI", "YES"];
export declare const HELP_KEYWORDS: readonly ["HELP", "AIDE", "INFO"];
export type InboundKeywordKind = 'opt_out' | 'opt_in' | 'help';
export interface InboundKeywordMatch {
    kind: InboundKeywordKind;
    /** Canonical keyword (upper-case, accents stripped), e.g. `ARRET`. */
    keyword: string;
}
/** Upper-case, accents stripped, surrounding whitespace/punctuation removed. */
export declare function normalizeKeyword(body: string): string;
/**
 * Classify an inbound SMS body. Only a message that IS the keyword (after
 * normalization) matches — "STOP" or "stop." do, "please stop" does not, the
 * same rule Twilio applies. Returns `null` for anything else.
 */
export declare function classifyInboundKeyword(body: string | null | undefined): InboundKeywordMatch | null;
//# sourceMappingURL=keywords.d.ts.map