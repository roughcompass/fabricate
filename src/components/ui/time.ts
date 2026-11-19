/** Time formatting shared by components and pages. Pure functions, so they can be tested directly. */

const absoluteDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const absoluteDateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The full UTC time, for tooltips and machine-readable markup. */
export function formatAbsolute(value: Date): string {
  return `${absoluteDateTime.format(value)} UTC`;
}

/** The UTC date alone: "Oct 2, 2026". */
export function formatDate(value: Date): string {
  return absoluteDate.format(value);
}

/** A UTC month and day, for chart labels: "Oct 12". */
export function formatShortDate(value: Date): string {
  return shortDate.format(value);
}

/**
 * Relative time within the last seven days ("3 hours ago"), and the date
 * otherwise. Times slightly in the future, from clock skew, read as "just now".
 */
export function formatRelative(value: Date, now: Date = new Date()): string {
  const elapsed = now.getTime() - value.getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return days === 1 ? "yesterday" : plural(days, "day");
  }
  return absoluteDate.format(value);
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/** How long something took: "45s", "3m 5s", or "1h 2m"; under a second, "<1s". */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 60)}h`;
}
