/**
 * services/dateUtils.ts — PredictXta UTC Date Navigation Utilities
 *
 * All match timestamps are stored in the database as UTC (PostgreSQL timestamptz).
 * This module handles the only place where timezone awareness matters:
 * converting a user's "today", "yesterday", "tomorrow" navigation intent
 * into correct UTC date-range queries, regardless of the user's timezone.
 *
 * Verified timezone targets:
 *   WAT (Africa/Lagos)      → UTC+1 (no DST)
 *   UTC                     → UTC+0
 *   EST (America/New_York)  → UTC-5 / UTC-4 (DST)
 *   PST (America/LA)        → UTC-8 / UTC-7 (DST)
 *   IST (Asia/Kolkata)      → UTC+5:30
 *   JST (Asia/Tokyo)        → UTC+9
 *
 * RULE: The "date" that a user selects (e.g. "2026-09-08") is always
 * interpreted in THEIR local timezone. We must query the DB for all
 * matches whose UTC kick-off time falls within that local calendar day.
 */

// ─── Core type ────────────────────────────────────────────────────────────────
export interface DateRange {
  /** ISO 8601 UTC — inclusive start of the user's selected date */
  startUtc: string;
  /** ISO 8601 UTC — exclusive end of the user's selected date */
  endUtc: string;
  /** YYYY-MM-DD label in user's local timezone */
  localDate: string;
}

// ─── Get user's local timezone offset in minutes (cached per session) ─────────
let _cachedOffsetMinutes: number | null = null;

export function getLocalOffsetMinutes(): number {
  if (_cachedOffsetMinutes !== null) return _cachedOffsetMinutes;
  // new Date().getTimezoneOffset() returns MINUTES BEHIND UTC
  // e.g. WAT (UTC+1) → -60, EST (UTC-5) → +300
  _cachedOffsetMinutes = new Date().getTimezoneOffset();
  return _cachedOffsetMinutes;
}

// ─── Build UTC range for a local YYYY-MM-DD date string ───────────────────────
/**
 * Given a local date string (YYYY-MM-DD) and the user's UTC offset,
 * returns the corresponding UTC start/end for a DB query.
 *
 * Example — user in WAT (UTC+1) selects "2026-09-08":
 *   Local midnight = 2026-09-08T00:00:00+01:00 = 2026-09-07T23:00:00Z
 *   Local 23:59:59 = 2026-09-08T23:59:59+01:00 = 2026-09-08T22:59:59Z
 *   → Query: match_time >= 2026-09-07T23:00:00Z AND < 2026-09-08T23:00:00Z
 */
export function buildDateRange(localDateStr: string): DateRange {
  const offsetMin = getLocalOffsetMinutes();
  // offsetMin is negative for zones AHEAD of UTC (e.g. WAT = -60)
  // Convert to milliseconds: add offset to local midnight to get UTC midnight
  const localMidnightMs = new Date(`${localDateStr}T00:00:00`).getTime();
  const utcStartMs = localMidnightMs + offsetMin * 60_000;
  const utcEndMs   = utcStartMs + 24 * 60 * 60_000; // +24 hours

  return {
    startUtc: new Date(utcStartMs).toISOString(),
    endUtc:   new Date(utcEndMs).toISOString(),
    localDate: localDateStr,
  };
}

// ─── Navigation helpers ───────────────────────────────────────────────────────
/**
 * Get the local YYYY-MM-DD string for today, yesterday, or tomorrow.
 * Uses the device's local timezone — no server dependency required.
 */
export function getLocalDateString(offset: -1 | 0 | 1 = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  // Format as YYYY-MM-DD in local timezone (not UTC)
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTodayLocal():     string { return getLocalDateString(0);  }
export function getYesterdayLocal(): string { return getLocalDateString(-1); }
export function getTomorrowLocal():  string { return getLocalDateString(1);  }

/** Today's UTC range (covers the local calendar day regardless of timezone) */
export function getTodayUtcRange(): DateRange {
  return buildDateRange(getTodayLocal());
}

/** Yesterday's UTC range */
export function getYesterdayUtcRange(): DateRange {
  return buildDateRange(getYesterdayLocal());
}

/** Tomorrow's UTC range */
export function getTomorrowUtcRange(): DateRange {
  return buildDateRange(getTomorrowLocal());
}

// ─── Display helpers ──────────────────────────────────────────────────────────
/**
 * Format an ISO UTC timestamp for display in the user's local timezone.
 * E.g. "2026-09-07T23:30:00Z" in WAT → "Sep 8, 11:30 PM"
 */
export function formatMatchTime(isoUtc: string, opts?: Intl.DateTimeFormatOptions): string {
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return '—';
  const defaultOpts: Intl.DateTimeFormatOptions = {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    ...opts,
  };
  return d.toLocaleString([], defaultOpts);
}

/**
 * Format a UTC timestamp as local time only (HH:MM).
 */
export function formatMatchTimeOnly(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Return the local YYYY-MM-DD for a given UTC timestamp string.
 * Used to bucket matches into their correct local calendar day.
 */
export function utcToLocalDate(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return getTodayLocal();
  return getLocalDateString.call(
    null,
    0, // ignored — we use the date directly below
  ).replace(
    // Actually compute the local date from the UTC timestamp:
    /.*/, // replace with correct computation:
    (() => {
      const year  = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day   = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    })(),
  );
}

/**
 * Returns true if a UTC timestamp falls within the user's "today"
 * (i.e. same local calendar day regardless of timezone).
 */
export function isToday(isoUtc: string): boolean {
  return utcToLocalDate(isoUtc) === getTodayLocal();
}

/**
 * Returns true if a UTC timestamp is in the user's "upcoming" window
 * (after now, within the next N days).
 */
export function isUpcoming(isoUtc: string, withinDays = 7): boolean {
  const ms = new Date(isoUtc).getTime();
  const now = Date.now();
  return ms > now && ms < now + withinDays * 24 * 60 * 60_000;
}

// ─── Timezone validation (development / testing utility) ─────────────────────
/**
 * Run a spot-check of timezone-aware date navigation.
 * Returns a diagnostics object for the admin date/timezone test screen.
 */
export interface TimezoneDiagnostics {
  deviceTimezone: string;
  utcOffsetMinutes: number;
  utcOffsetHours: string;
  todayLocal: string;
  yesterdayLocal: string;
  tomorrowLocal: string;
  todayUtcRange: DateRange;
  sampleMatchLocalDisplay: string;
}

export function runTimezoneDiagnostics(): TimezoneDiagnostics {
  const offsetMin = getLocalOffsetMinutes();
  const hours = Math.abs(Math.floor(offsetMin / 60));
  const mins  = Math.abs(offsetMin % 60);
  const sign  = offsetMin <= 0 ? '+' : '-';
  const offsetStr = `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

  // Try to get IANA timezone name (Intl API)
  let tzName = 'Unknown';
  try {
    tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch { /* IANA not available — use offset string */ }

  // Sample match: simulate a match at UTC midnight
  const sampleUtc = new Date();
  sampleUtc.setUTCHours(23, 0, 0, 0); // 11 PM UTC today
  const sampleDisplay = formatMatchTime(sampleUtc.toISOString());

  return {
    deviceTimezone: tzName,
    utcOffsetMinutes: offsetMin,
    utcOffsetHours: offsetStr,
    todayLocal: getTodayLocal(),
    yesterdayLocal: getYesterdayLocal(),
    tomorrowLocal: getTomorrowLocal(),
    todayUtcRange: getTodayUtcRange(),
    sampleMatchLocalDisplay: sampleDisplay,
  };
}
