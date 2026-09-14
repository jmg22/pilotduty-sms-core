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

export const DEFAULT_QUIET_HOURS: QuietHoursWindow = {
  startHour: 21,
  endHour: 8,
};

interface WallClock {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
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
export function wallClock(date: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
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
export function isValidTimeZone(timeZone: string | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function localHour(date: Date, timeZone: string): number {
  return wallClock(date, timeZone).hour;
}

/** Convert a local wall-clock time in `timeZone` to a UTC instant. */
export function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute?: number },
  timeZone: string,
): Date {
  const target = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute ?? 0,
    0,
  );
  let guess = target;
  // Two passes absorb a DST transition between the guess and the answer.
  for (let i = 0; i < 2; i++) {
    const w = wallClock(new Date(guess), timeZone);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    guess += target - asUtc;
  }
  return new Date(guess);
}

export function isWithinQuietHours(
  date: Date,
  timeZone: string,
  window: QuietHoursWindow = DEFAULT_QUIET_HOURS,
): boolean {
  const hour = localHour(date, timeZone);
  const { startHour, endHour } = window;
  if (startHour === endHour) return false;
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
export function nextQuietHoursEnd(
  date: Date,
  timeZone: string,
  window: QuietHoursWindow = DEFAULT_QUIET_HOURS,
): Date {
  const w = wallClock(date, timeZone);
  const sameDay = w.hour < window.endHour;
  const base = new Date(Date.UTC(w.year, w.month - 1, w.day + (sameDay ? 0 : 1)));
  return zonedTimeToUtc(
    {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
      hour: window.endHour,
      minute: 0,
    },
    timeZone,
  );
}
