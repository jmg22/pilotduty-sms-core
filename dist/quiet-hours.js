"use strict";
/**
 * Quiet hours (TOT-204, decision 4 of the reference document): no `reminder`
 * between 21:00 and 08:00 in the RECIPIENT's local time. `safety` and
 * `transactional` go out at any hour. A reminder falling in the window is
 * DEFERRED to 08:00, never dropped — this module computes the instant; the
 * caller reschedules.
 *
 * Pure `Intl` — no date library.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_QUIET_HOURS = void 0;
exports.wallClock = wallClock;
exports.isValidTimeZone = isValidTimeZone;
exports.localHour = localHour;
exports.zonedTimeToUtc = zonedTimeToUtc;
exports.isWithinQuietHours = isWithinQuietHours;
exports.nextQuietHoursEnd = nextQuietHoursEnd;
exports.DEFAULT_QUIET_HOURS = {
    startHour: 21,
    endHour: 8,
};
const formatterCache = new Map();
function formatterFor(timeZone) {
    let dtf = formatterCache.get(timeZone);
    if (!dtf) {
        // Throws RangeError on an unknown time zone — callers decide.
        dtf = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        formatterCache.set(timeZone, dtf);
    }
    return dtf;
}
/** Local wall-clock components of `date` in `timeZone`. */
function wallClock(date, timeZone) {
    const parts = {};
    for (const part of formatterFor(timeZone).formatToParts(date)) {
        if (part.type !== 'literal')
            parts[part.type] = Number(part.value);
    }
    return {
        year: parts.year ?? 0,
        month: parts.month ?? 1,
        day: parts.day ?? 1,
        // Some engines still emit 24 at midnight even with h23.
        hour: (parts.hour ?? 0) % 24,
        minute: parts.minute ?? 0,
        second: parts.second ?? 0,
    };
}
/** `true` when `timeZone` is an IANA zone this runtime understands. */
function isValidTimeZone(timeZone) {
    if (!timeZone)
        return false;
    try {
        formatterFor(timeZone);
        return true;
    }
    catch {
        return false;
    }
}
function localHour(date, timeZone) {
    return wallClock(date, timeZone).hour;
}
/** Convert a local wall-clock time in `timeZone` to a UTC instant. */
function zonedTimeToUtc(wall, timeZone) {
    const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute ?? 0, 0);
    let guess = target;
    // Two passes absorb a DST transition between the guess and the answer.
    for (let i = 0; i < 2; i++) {
        const w = wallClock(new Date(guess), timeZone);
        const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
        guess += target - asUtc;
    }
    return new Date(guess);
}
function isWithinQuietHours(date, timeZone, window = exports.DEFAULT_QUIET_HOURS) {
    const hour = localHour(date, timeZone);
    const { startHour, endHour } = window;
    if (startHour === endHour)
        return false;
    if (startHour > endHour) {
        // Wraps midnight (21 → 8).
        return hour >= startHour || hour < endHour;
    }
    return hour >= startHour && hour < endHour;
}
/**
 * The next instant at which quiet hours end in `timeZone` — i.e. when a
 * deferred reminder may be sent. Assumes `date` IS within quiet hours.
 */
function nextQuietHoursEnd(date, timeZone, window = exports.DEFAULT_QUIET_HOURS) {
    const w = wallClock(date, timeZone);
    const sameDay = w.hour < window.endHour;
    const base = new Date(Date.UTC(w.year, w.month - 1, w.day + (sameDay ? 0 : 1)));
    return zonedTimeToUtc({
        year: base.getUTCFullYear(),
        month: base.getUTCMonth() + 1,
        day: base.getUTCDate(),
        hour: window.endHour,
        minute: 0,
    }, timeZone);
}
//# sourceMappingURL=quiet-hours.js.map