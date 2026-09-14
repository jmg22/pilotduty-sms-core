import { calculateSmsSegments } from './segments';
import type { ConsentStatus, SmsCategory } from './types';

/**
 * Resolves a template body for `(templateId, locale)` from the catalogue
 * (TOT-200/201/202 — family A lives in the webapp's `notifications.json`,
 * family B in Functions). Return `null`/`undefined` when unknown.
 */
export type TemplateResolver = (
  templateId: string,
  locale: string,
) => string | null | undefined | Promise<string | null | undefined>;

export interface RenderedTemplate {
  body: string;
  /** Placeholders present in the template with no value in `params`. */
  missing: string[];
}

const PLACEHOLDER = /\{\{\s*([\w.\-]+)\s*\}\}/g;

/**
 * Replace `{{key}}` placeholders. Keys may be dotted (`organization.name`)
 * and are looked up LITERALLY in `params` — no nested objects. A missing
 * value renders as an empty string and is reported in `missing`.
 */
export function renderTemplate(
  template: string,
  params: Record<string, string>,
): RenderedTemplate {
  const missing: string[] = [];
  const body = template.replace(PLACEHOLDER, (_match, key: string) => {
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
 * ⚠ The French wording contains `ê` (arrêter), which is NOT GSM-7: it flips
 * the whole message to UCS-2 (70 chars/segment). Flagged to the pilot; the
 * gateway logs `footer_pushed_second_segment` when that costs a segment.
 */
export const STOP_FOOTERS: Readonly<Record<string, string>> = {
  en: ' Reply STOP to opt out, HELP for help.',
  fr: " Répondez STOP pour arrêter, AIDE pour de l'aide.",
};

export function baseLanguage(locale: string | undefined): string {
  return (locale ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en';
}

export function footerFor(
  locale: string | undefined,
  footers: Readonly<Record<string, string>> = STOP_FOOTERS,
): string {
  return footers[baseLanguage(locale)] ?? footers.en ?? STOP_FOOTERS.en ?? '';
}

export const FIRST_CONTACT_WINDOW_DAYS = 30;

export type FooterReason = 'first_contact' | 'safety' | 'consent_not_opted_in';

export interface FooterDecision {
  needed: boolean;
  reasons: FooterReason[];
}

/**
 * TOT-199: append the STOP/HELP footer when ANY of these holds —
 *   - no message to this number in the last 30 days (first contact);
 *   - `category = safety`;
 *   - consent status ≠ `opted_in` (forced by TOT-193).
 */
export function decideFooter(input: {
  category: SmsCategory;
  consentStatus: ConsentStatus;
  lastMessageAt: Date | null;
  now: Date;
  windowDays?: number;
}): FooterDecision {
  const reasons: FooterReason[] = [];
  const windowMs = (input.windowDays ?? FIRST_CONTACT_WINDOW_DAYS) * 86_400_000;
  if (
    !input.lastMessageAt ||
    input.now.getTime() - input.lastMessageAt.getTime() >= windowMs
  ) {
    reasons.push('first_contact');
  }
  if (input.category === 'safety') reasons.push('safety');
  if (input.consentStatus !== 'opted_in') reasons.push('consent_not_opted_in');
  return { needed: reasons.length > 0, reasons };
}

export interface ComposedBody {
  body: string;
  footerApplied: boolean;
  segments: number;
  encoding: 'GSM-7' | 'UCS-2';
  /** Segments of the body BEFORE the footer (for the 4.5 warning). */
  segmentsBeforeFooter: number;
  footerPushedSegment: boolean;
}

/**
 * Append the footer (idempotent: a body that already ends with it is left
 * alone) and measure. Segments are computed on the body WITHOUT the footer
 * first, then WITH — TOT-199 asks for a warning when the footer alone pushes
 * the message to another segment.
 */
export function applyFooter(
  body: string,
  footer: string,
  needed: boolean,
): ComposedBody {
  const before = calculateSmsSegments(body);
  const alreadyThere = body.trimEnd().endsWith(footer.trim());
  const shouldAppend = needed && !alreadyThere && footer.length > 0;
  const finalBody = shouldAppend ? body.trimEnd() + footer : body;
  const after = calculateSmsSegments(finalBody);
  return {
    body: finalBody,
    footerApplied: shouldAppend || (needed && alreadyThere),
    segments: after.segments,
    encoding: after.encoding,
    segmentsBeforeFooter: before.segments,
    footerPushedSegment: shouldAppend && after.segments > before.segments,
  };
}
