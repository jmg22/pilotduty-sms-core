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
import type { SmsEncoding } from './types';
export declare const SMS_LIMITS: Record<SmsEncoding, {
    single: number;
    multipart: number;
}>;
export interface SmsSegmentInfo {
    encoding: SmsEncoding;
    /** Length in the encoding's unit (GSM-7 septets or UTF-16 units). */
    length: number;
    /** 0 for an empty message. */
    segments: number;
    /** Capacity of a single-segment message in this encoding. */
    singleSegmentLimit: number;
    /** Capacity per segment once the message is concatenated. */
    multipartSegmentLimit: number;
}
/** `true` if ALL of the text fits in the GSM-7 alphabet (basic + extension). */
export declare function isGsm7(text: string): boolean;
export declare function detectSmsEncoding(text: string): SmsEncoding;
/** Encoding, length and number of segments of an SMS body. */
export declare function calculateSmsSegments(text: string): SmsSegmentInfo;
//# sourceMappingURL=segments.d.ts.map