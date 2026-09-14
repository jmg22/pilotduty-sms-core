/**
 * Twilio error classification — "Plan de vol SMS PilotDuty — référence" §7
 * and TOT-207. The gateway always records `code` and `moreInfo`; consumers
 * branch on `class` (Sentry `fatal` on `unregistered_sender`, etc.).
 */
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
export declare function classifyTwilioError(code: number | undefined): TwilioErrorClass;
/** Classes for which a retry can never succeed (same number, same content). */
export declare function isPermanentTwilioError(errorClass: TwilioErrorClass): boolean;
export interface TwilioErrorInfo {
    code?: number;
    status?: number;
    message: string;
    moreInfo?: string;
    class: TwilioErrorClass;
}
/** Extract what matters from whatever `messages.create()` rejected with. */
export declare function describeTwilioError(err: unknown): TwilioErrorInfo;
//# sourceMappingURL=errors.d.ts.map