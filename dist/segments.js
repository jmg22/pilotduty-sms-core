"use strict";
/**
 * SMS segments according to the REAL encoding (GSM 03.38).
 *
 * Vendored verbatim from PilotDutySaas
 * `src/lib/booking/notifications/utils/sms-segments.ts` (TOT-240, M5 of
 * TOT-147), so that webapp, Functions and the iOS relay count segments the
 * same way. The webapp copy is the one wired to the template editor; keep the
 * two identical until the editor imports this package (TOT-203).
 *
 * Rules:
 *   - GSM-7: every character belongs to the basic alphabet or to its
 *     extension table (extension characters cost 2 septets: `^ { } \ [ ~ ] | €`).
 *     160 characters for one segment, 153 per segment beyond (UDH header).
 *   - UCS-2: as soon as ONE character is outside GSM-7 (`ç`, `ê`, `œ`, emoji…).
 *     70 characters for one segment, 67 per segment beyond. Length is in
 *     UTF-16 units (`String.length`): an emoji outside the BMP counts 2.
 *
 * Known traps: `é è ù à ì ò` ARE GSM-7 (basic alphabet), but lowercase `ç`,
 * `â ê î ô û ë ï`, `œ` and accented capitals other than `É Ç` are not. An
 * "accented" French text is therefore not automatically UCS-2: this module
 * decides, not intuition.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SMS_LIMITS = void 0;
exports.isGsm7 = isGsm7;
exports.detectSmsEncoding = detectSmsEncoding;
exports.calculateSmsSegments = calculateSmsSegments;
/** GSM 03.38 basic alphabet (128 characters, 1 septet each). */
const GSM7_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** GSM 03.38 extension table (ESC prefix: 2 septets each). */
const GSM7_EXTENSION = '\f^{}\\[~]|€';
const GSM7_BASIC_SET = new Set(GSM7_BASIC);
const GSM7_EXTENSION_SET = new Set(GSM7_EXTENSION);
exports.SMS_LIMITS = {
    'GSM-7': { single: 160, multipart: 153 },
    'UCS-2': { single: 70, multipart: 67 },
};
/** `true` if ALL of the text fits in the GSM-7 alphabet (basic + extension). */
function isGsm7(text) {
    for (const char of text) {
        if (!GSM7_BASIC_SET.has(char) && !GSM7_EXTENSION_SET.has(char))
            return false;
    }
    return true;
}
function detectSmsEncoding(text) {
    return isGsm7(text) ? 'GSM-7' : 'UCS-2';
}
/** Length in septets of a GSM-7 text (extension characters = 2). */
function gsm7Length(text) {
    let length = 0;
    for (const char of text) {
        length += GSM7_EXTENSION_SET.has(char) ? 2 : 1;
    }
    return length;
}
/** Encoding, length and number of segments of an SMS body. */
function calculateSmsSegments(text) {
    const encoding = detectSmsEncoding(text);
    const limits = exports.SMS_LIMITS[encoding];
    const length = encoding === 'GSM-7' ? gsm7Length(text) : text.length;
    const segments = length === 0
        ? 0
        : length <= limits.single
            ? 1
            : Math.ceil(length / limits.multipart);
    return {
        encoding,
        length,
        segments,
        singleSegmentLimit: limits.single,
        multipartSegmentLimit: limits.multipart,
    };
}
//# sourceMappingURL=segments.js.map