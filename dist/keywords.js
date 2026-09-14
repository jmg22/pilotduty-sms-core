"use strict";
/**
 * Inbound keywords — the single list shared by the inbound webhook
 * (PilotDutySaas `/api/twilio/inbound`, TOT-197) and Twilio's Advanced
 * Opt-Out configuration (TOT-196). Matching is case- and accent-insensitive
 * (`Arrêt`, `ARRET`, `arret` are the same keyword).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELP_KEYWORDS = exports.OPT_IN_KEYWORDS = exports.OPT_OUT_KEYWORDS = void 0;
exports.normalizeKeyword = normalizeKeyword;
exports.classifyInboundKeyword = classifyInboundKeyword;
exports.OPT_OUT_KEYWORDS = [
    'STOP',
    'ARRET',
    'UNSUBSCRIBE',
    'CANCEL',
    'END',
    'QUIT',
];
exports.OPT_IN_KEYWORDS = ['START', 'UNSTOP', 'OUI', 'YES'];
exports.HELP_KEYWORDS = ['HELP', 'AIDE', 'INFO'];
/** Upper-case, accents stripped, surrounding whitespace/punctuation removed. */
function normalizeKeyword(body) {
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
function classifyInboundKeyword(body) {
    if (!body)
        return null;
    const keyword = normalizeKeyword(body);
    if (!keyword)
        return null;
    if (exports.OPT_OUT_KEYWORDS.includes(keyword)) {
        return { kind: 'opt_out', keyword };
    }
    if (exports.OPT_IN_KEYWORDS.includes(keyword)) {
        return { kind: 'opt_in', keyword };
    }
    if (exports.HELP_KEYWORDS.includes(keyword)) {
        return { kind: 'help', keyword };
    }
    return null;
}
//# sourceMappingURL=keywords.js.map