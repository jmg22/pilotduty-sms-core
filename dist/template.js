"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIRST_CONTACT_WINDOW_DAYS = exports.STOP_FOOTERS = void 0;
exports.renderTemplate = renderTemplate;
exports.baseLanguage = baseLanguage;
exports.footerFor = footerFor;
exports.decideFooter = decideFooter;
exports.applyFooter = applyFooter;
const segments_1 = require("./segments");
const PLACEHOLDER = /\{\{\s*([\w.\-]+)\s*\}\}/g;
/**
 * Replace `{{key}}` placeholders. Keys may be dotted (`organization.name`)
 * and are looked up LITERALLY in `params` — no nested objects. A missing
 * value renders as an empty string and is reported in `missing`.
 */
function renderTemplate(template, params) {
    const missing = [];
    const body = template.replace(PLACEHOLDER, (_match, key) => {
        const value = params[key];
        if (value === undefined || value === null) {
            missing.push(key);
            return '';
        }
        return String(value);
    });
    return { body, missing };
}
/**
 * STOP/HELP footers, TOT-199 wording. Keyed by base language; anything else
 * falls back to English. Overridable through `createSmsGateway({ footers })`.
 *
 * Both wordings are 100 % GSM-7 (decision P8, v0.1.1): the French one avoids
 * `ê` ("arrêter"), which flipped the whole message to UCS-2 (70 chars/segment)
 * in v0.1.0. `é` IS part of the GSM-7 default alphabet. The gateway still logs
 * `footer_pushed_second_segment` when the footer alone costs a segment.
 */
exports.STOP_FOOTERS = {
    en: ' Reply STOP to opt out, HELP for help.',
    fr: " Répondez STOP pour ne plus recevoir, AIDE pour de l'aide.",
};
function baseLanguage(locale) {
    return (locale ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en';
}
function footerFor(locale, footers = exports.STOP_FOOTERS) {
    return footers[baseLanguage(locale)] ?? footers.en ?? exports.STOP_FOOTERS.en ?? '';
}
exports.FIRST_CONTACT_WINDOW_DAYS = 30;
/**
 * TOT-199: append the STOP/HELP footer when ANY of these holds —
 *   - no message to this number in the last 30 days (first contact);
 *   - `category = safety`;
 *   - consent status ≠ `opted_in` (forced by TOT-193).
 */
function decideFooter(input) {
    const reasons = [];
    const windowMs = (input.windowDays ?? exports.FIRST_CONTACT_WINDOW_DAYS) * 86400000;
    if (!input.lastMessageAt ||
        input.now.getTime() - input.lastMessageAt.getTime() >= windowMs) {
        reasons.push('first_contact');
    }
    if (input.category === 'safety')
        reasons.push('safety');
    if (input.consentStatus !== 'opted_in')
        reasons.push('consent_not_opted_in');
    return { needed: reasons.length > 0, reasons };
}
/**
 * Append the footer (idempotent: a body that already ends with it is left
 * alone) and measure. Segments are computed on the body WITHOUT the footer
 * first, then WITH — TOT-199 asks for a warning when the footer alone pushes
 * the message to another segment.
 */
function applyFooter(body, footer, needed) {
    const before = (0, segments_1.calculateSmsSegments)(body);
    const alreadyThere = body.trimEnd().endsWith(footer.trim());
    const shouldAppend = needed && !alreadyThere && footer.length > 0;
    const finalBody = shouldAppend ? body.trimEnd() + footer : body;
    const after = (0, segments_1.calculateSmsSegments)(finalBody);
    return {
        body: finalBody,
        footerApplied: shouldAppend || (needed && alreadyThere),
        segments: after.segments,
        encoding: after.encoding,
        segmentsBeforeFooter: before.segments,
        footerPushedSegment: shouldAppend && after.segments > before.segments,
    };
}
//# sourceMappingURL=template.js.map