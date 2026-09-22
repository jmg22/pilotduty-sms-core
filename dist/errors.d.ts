/**
 * Twilio error classification — "Plan de vol SMS PilotDuty — référence" §7,
 * TOT-207 and decision P48: the table lives HERE, one truth for the webapp
 * (send path + status callback) and Functions (iOS relay + fan-out).
 *
 * | code                  | action                  | effect at the caller                                   |
 * | 30034                 | alert_fatal             | Sentry `fatal`, immediately                            |
 * | 21610                 | opt_out_retroactive     | create `sms_opt_outs/{e164}` (`source: twilio_21610`)  |
 * | 30003 / 30005         | unreachable_increment   | `evidence.unreachableCount++`, suspended at 3          |
 * | 30007                 | carrier_filtered        | reputation counter; alert above 2 % over 24 h          |
 * | 30006                 | mark_landline           | `evidence.landline = true`, never try again            |
 * | 21211 / 21614 / 21408 | mark_invalid            | `evidence.invalid = true`, never try again (TOT-275)   |
 * | anything else         | log_only                | log `code` + `moreInfo`                                |
 *
 * `retry` is `false` for every row: no integration ever retries a Twilio
 * refusal (TOT-169 §7, TOT-183 — a retry loop is an SMS storm).
 */
export type TwilioErrorAction = 'alert_fatal' | 'opt_out_retroactive' | 'unreachable_increment' | 'carrier_filtered' | 'mark_landline' | 'mark_invalid' | 'log_only';
/** Sentry levels — the caller reports with this level as is. */
export type TwilioErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';
export interface TwilioErrorClassification {
    action: TwilioErrorAction;
    severity: TwilioErrorSeverity;
    /** Always `false` — see the header. */
    retry: false;
}
/** The TOT-207 table, code by code. Anything absent is `log_only`. */
export declare const TWILIO_ERROR_ACTIONS: Readonly<Record<number, TwilioErrorAction>>;
/**
 * - `fatal`: must never happen once the campaign is registered (6b).
 * - `info`: the recipient's own choice, handled automatically.
 * - `warning`: a send was lost; the per-number effect is applied by the caller
 *   (the 2 % alert on 30007 is computed by the status callback, not here).
 */
export declare const TWILIO_ERROR_SEVERITIES: Readonly<Record<TwilioErrorAction, TwilioErrorSeverity>>;
/** 30003 / 30005: the number is suspended once `unreachableCount` reaches this. */
export declare const UNREACHABLE_SUSPEND_AFTER = 3;
/**
 * Twilio hands the code over as a number (`RestException.code`) or as a
 * string (`ErrorCode` form field of the status callback). Anything that is
 * not a plain positive integer is "no code".
 */
export declare function parseTwilioErrorCode(code: unknown): number | undefined;
/**
 * TOT-207 — what to do with a Twilio error code, whether it comes from the
 * API error of `messages.create()` or from the `ErrorCode` of the status
 * callback. Unknown, missing and non-numeric codes are `log_only`.
 */
export declare function classifyTwilioError(code: unknown): TwilioErrorClassification;
/** v0.1 vocabulary, kept on `describeTwilioError().class` and `FailedResult.errorClass`. */
export type TwilioErrorClass = 
/** 30034 — sender not registered for A2P. Must never happen after 6b. */
'unregistered_sender'
/** 21610 — recipient unsubscribed at Twilio. Retroactive opt-out. */
 | 'opted_out'
/** 30003 / 30005 — unreachable / unknown destination. */
 | 'unreachable'
/** 30007 — filtered by the carrier. Reputation signal. */
 | 'carrier_filtered'
/** 30006 — landline. Never retry. */
 | 'landline'
/** 21211 / 21614 / 21408 — invalid number or region not enabled (TOT-275). */
 | 'invalid_number' | 'other';
export declare function twilioErrorClassOf(action: TwilioErrorAction): TwilioErrorClass;
/** Classes for which a retry can never succeed (same number, same content). */
export declare function isPermanentTwilioError(errorClass: TwilioErrorClass): boolean;
/**
 * Twilio error messages can quote the destination ("The 'To' number
 * +1514… is not a valid phone number"). Logs never carry a phone number:
 * every run of 7+ digits (with the usual separators) is masked.
 */
export declare function redactPhoneNumbers(text: string): string;
export interface TwilioErrorInfo extends TwilioErrorClassification {
    code?: number;
    status?: number;
    /**
     * ALREADY REDACTED (`redactPhoneNumbers`, v0.2.1): the raw Twilio text never
     * leaves this function — not to a log, not to `FailedResult.errorMessage`,
     * not to `sms_messages.errorMessage`.
     */
    message: string;
    moreInfo?: string;
    class: TwilioErrorClass;
}
/** Extract what matters from whatever `messages.create()` rejected with. */
export declare function describeTwilioError(err: unknown): TwilioErrorInfo;
/** Subset of `sms_consent.evidence` written by the TOT-207 effects. */
export interface TwilioErrorEvidence {
    unreachableCount?: number;
    unreachableSuspended?: boolean;
    unreachableLiftedAt?: Date;
    landline?: boolean;
    invalid?: boolean;
    lastTwilioErrorCode?: number;
    lastTwilioErrorAt?: Date;
}
/**
 * TOT-207 — the fields to merge into `sms_consent.evidence` of EVERY consent
 * document of the number, so the webapp and Functions write the same thing.
 * `null` when the action has no per-number effect (`alert_fatal`,
 * `opt_out_retroactive` — that one writes `sms_opt_outs` —, `carrier_filtered`,
 * `log_only`). For `unreachable_increment` the caller passes the current
 * evidence of the document it is updating, inside its own transaction.
 */
export declare function consentEvidencePatch(action: TwilioErrorAction, current: Pick<TwilioErrorEvidence, 'unreachableCount'> | null | undefined, error: {
    code?: number;
    at: Date;
}): TwilioErrorEvidence | null;
/**
 * P49 §5 — what lifts `unreachable_suspended`: ANY inbound SMS from the number
 * (proof it is reachable) or the admin "retry" action. `invalid` and
 * `landline` are never lifted (a corrected number is another document).
 * Merge this into `sms_consent.evidence` of every consent document of the number.
 */
export declare function unreachableLiftPatch(at: Date): {
    unreachableCount: 0;
    unreachableSuspended: false;
    unreachableLiftedAt: Date;
};
/**
 * TOT-207 / P50 §2 — projection de `sms_consent.evidence` vers l'état de
 * livraison affiché sur un suiveur (`flightFollowingFollowers/{id}.smsDelivery`).
 *
 * Une seule définition de forme pour les deux dépôts : Functions et le Manager
 * l'appellent au moment où ils posent (ou lèvent) une marque, au lieu de
 * recopier chacun sa propre logique de badge — c'est le trou de recopie que
 * P50 §2 ferme, sans nouveau déclencheur.
 *
 * Priorité : `invalid` > `landline` > `unreachable_suspended` > `unreachable`
 * (des échecs comptés, pas encore bloquants) > `ok`. Elle suit celle de
 * `decideConsent`, à un détail près : `unreachable` n'y refuse rien — c'est une
 * information pour l'exploitant, pas un blocage, et l'interface peut n'afficher
 * que les états bloquants (`isBlockingDeliveryState`).
 */
export type DeliveryState = 
/** Aucune marque : rien à signaler. */
'ok'
/** 30003 / 30005 comptés, sous le seuil de suspension. N'empêche aucun envoi. */
 | 'unreachable'
/** Suspendu après `UNREACHABLE_SUSPEND_AFTER`. Bloque tout sauf `safety` (P50 §0). */
 | 'unreachable_suspended'
/** 30006. Bloque toutes les catégories. */
 | 'landline'
/** 21211 / 21614 / 21408. Bloque toutes les catégories. */
 | 'invalid';
export interface DeliveryProjection {
    state: DeliveryState;
    /** Horodatage de la dernière erreur Twilio connue (absent si aucune). */
    at?: Date;
    /** Dernier code Twilio connu (absent si aucun). */
    code?: number;
}
/** États qui empêchent au moins une catégorie de partir — ceux qui méritent un badge. */
export declare function isBlockingDeliveryState(state: DeliveryState): boolean;
export declare function projectDeliveryState(evidence: TwilioErrorEvidence | null | undefined): DeliveryProjection;
//# sourceMappingURL=errors.d.ts.map