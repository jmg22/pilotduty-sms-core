/**
 * Quiet hours (TOT-204, decision 4 of the reference document): no `reminder`
 * between 21:00 and 08:00 in the RECIPIENT's local time. `safety` and
 * `transactional` go out at any hour. A reminder falling in the window is
 * DEFERRED to 08:00, never dropped — this module computes the instant; the
 * caller reschedules.
 *
 * Pure `Intl` — no date library.
 */
export interface QuietHoursWindow {
    /** Local hour (0–23) at which quiet hours start. */
    startHour: number;
    /** Local hour (0–23) at which quiet hours end (exclusive). */
    endHour: number;
}
export declare const DEFAULT_QUIET_HOURS: QuietHoursWindow;
interface WallClock {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}
/** Local wall-clock components of `date` in `timeZone`. */
export declare function wallClock(date: Date, timeZone: string): WallClock;
/** `true` when `timeZone` is an IANA zone this runtime understands. */
export declare function isValidTimeZone(timeZone: string | undefined): timeZone is string;
export declare function localHour(date: Date, timeZone: string): number;
/** Convert a local wall-clock time in `timeZone` to a UTC instant. */
export declare function zonedTimeToUtc(wall: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute?: number;
}, timeZone: string): Date;
export declare function isWithinQuietHours(date: Date, timeZone: string, window?: QuietHoursWindow): boolean;
/**
 * The next instant at which quiet hours end in `timeZone` — i.e. when a
 * deferred reminder may be sent. Assumes `date` IS within quiet hours.
 */
export declare function nextQuietHoursEnd(date: Date, timeZone: string, window?: QuietHoursWindow): Date;
export {};
//# sourceMappingURL=quiet-hours.d.ts.map