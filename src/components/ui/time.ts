/** Time formatting shared by components and pages. Pure functions, so they can be tested directly. */

const absoluteDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const absoluteDateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The full UTC time, for tooltips and machine-readable markup. */
export function formatAbsolute(value: Date): string {
  return `${absoluteDateTime.format(value)} UTC`;
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
