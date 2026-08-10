/**
 * services/dateUtils.ts — UTC/Timezone-aware date boundary utilities
 *
 * ARCHITECTURE (required by production integrity):
 *
 *   Provider event timestamp  → stored as match_time (timestamptz UTC)
 *          ↓
 *   User's local calendar date (device timezone)
 *          ↓
 *   Date menu selection (local date label "Today", "Tomorrow", etc.)
 *          ↓
 *   UTC start/end boundaries for that local date
 *          ↓
 *   DB query: match_time >= utcStart AND match_time < utcEnd
 *
 * CRITICAL RULE: Never use "UTC date == selected local date" for fixture
 * filtering. A match at 23:30 UTC on Aug 7 is 00:30 Aug 8 for UTC+1 users.
 * Using a UTC date as a filter would place it on the wrong day.
 *
 * All functions use the device's native Date object which automatically
 * applies the device's local timezone offset. No external timezone library
 * is needed for this approach.
 */

// ─── Core boundary functions ──────────────────────────────────────────────────

/**
 * Returns a Date representing 00:00:00.000 local time on the given local date.
 * When converted to ISO string, this gives the UTC equivalent for "start of
 * local day", which is the correct lower bound for DB queries.
 *
 * Example: local date Aug 7 in UTC+3 → 2026-08-06T21:00:00.000Z
 */
export function getLocalDayStart(localDate: Date): Date {
  const d = new Date(localDate);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns a Date representing 00:00:00.000 local time on the day AFTER
 * the given local date (exclusive upper bound for DB queries).
 *
 * Example: local date Aug 7 in UTC+3 → 2026-08-07T21:00:00.000Z
 */
export function getLocalDayEnd(localDate: Date): Date {
  const d = new Date(localDate);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Build UTC ISO range strings for querying a specific local calendar date.
 *
 * Usage in Supabase:
 *   const { utcStart, utcEnd } = getUTCRangeForLocalDate(selectedDate);
 *   .gte('match_time', utcStart).lt('match_time', utcEnd)
 */
export function getUTCRangeForLocalDate(localDate: Date): {
  utcStart: string;
  utcEnd: string;
} {
  return {
    utcStart: getLocalDayStart(localDate).toISOString(),
    utcEnd:   getLocalDayEnd(localDate).toISOString(),
  };
}

// ─── Relative date helpers ────────────────────────────────────────────────────

/**
 * Returns a local Date object for today + offsetDays (midnight local time).
 * offset 0 = today, -1 = yesterday, +1 = tomorrow, etc.
 */
export function getRelativeLocalDate(offsetDays: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

/**
 * Check whether two local Date objects represent the same calendar day
 * (ignoring time component).
 */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  );
}

/**
 * Return the local calendar date for a UTC timestamp string.
 * Used to determine which day a match appears on in the user's timezone.
 */
export function getLocalDateFromUTCString(utcTimestamp: string): Date {
  return new Date(utcTimestamp);
}

/**
 * Returns true if a UTC timestamp string falls within the given local calendar day.
 */
export function isOnLocalDate(utcTimestamp: string, localDate: Date): boolean {
  const matchDate = new Date(utcTimestamp);
  return matchDate >= getLocalDayStart(localDate) && matchDate < getLocalDayEnd(localDate);
}

// ─── Label helpers ────────────────────────────────────────────────────────────

/** Human-readable label for a date relative to today */
export function formatDateLabel(date: Date): string {
  const today = getRelativeLocalDate(0);
  const diffDays = Math.round(
    (getLocalDayStart(date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0)  return 'Today';
  if (diffDays === 1)  return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === -2) return '2 Days Ago';
  if (diffDays === 2)  return '+2 Days';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Short label for date chip (4–5 chars) */
export function formatDateChipLabel(date: Date): string {
  const today = getRelativeLocalDate(0);
  const diffDays = Math.round(
    (getLocalDayStart(date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0)  return 'Today';
  if (diffDays === 1)  return 'Tmrw';
  if (diffDays === -1) return 'Yest';
  return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
}

/** Day-of-week initial e.g. 'M', 'T', 'W' */
export function formatDayInitial(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'narrow' });
}

/** Day number e.g. '7' */
export function formatDayNumber(date: Date): string {
  return String(date.getDate());
}

/** Short month+day e.g. 'Aug 7' */
export function formatMonthDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── 5-day navigation config ──────────────────────────────────────────────────

export interface DateNavItem {
  offset: number;      // -2 to +2 relative to today
  date: Date;
  label: string;       // 'Today', 'Tomorrow', 'Yesterday', etc.
  chipLabel: string;   // Short chip text
  dayInitial: string;  // 'M'
  dayNumber: string;   // '7'
  monthDay: string;    // 'Aug 7'
  isToday: boolean;
  isPast: boolean;
  isFuture: boolean;
}

/**
 * Returns the 5-day navigation config array:
 * [2 days ago, yesterday, today, tomorrow, 2 days ahead]
 */
export function getDateNavItems(): DateNavItem[] {
  return [-2, -1, 0, 1, 2].map(offset => {
    const date = getRelativeLocalDate(offset);
    return {
      offset,
      date,
      label: formatDateLabel(date),
      chipLabel: formatDateChipLabel(date),
      dayInitial: formatDayInitial(date),
      dayNumber: formatDayNumber(date),
      monthDay: formatMonthDay(date),
      isToday: offset === 0,
      isPast: offset < 0,
      isFuture: offset > 0,
    };
  });
}

// ─── Extended window helpers (for backend queries) ────────────────────────────

/**
 * Returns UTC boundaries for a multi-day window starting from today.
 *
 * Use when you want to pre-load multiple days into a cache:
 *   const { utcStart, utcEnd } = getUTCWindowFromToday(-1, 7);
 *   // Loads yesterday through 7 days ahead
 */
export function getUTCWindowFromToday(
  startOffsetDays: number,
  endOffsetDays: number,
): { utcStart: string; utcEnd: string } {
  const start = getLocalDayStart(getRelativeLocalDate(startOffsetDays));
  const end   = getLocalDayEnd(getRelativeLocalDate(endOffsetDays));
  return {
    utcStart: start.toISOString(),
    utcEnd:   end.toISOString(),
  };
}
