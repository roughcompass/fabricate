/** Numbers as the interface writes them. The one place, with time.ts, that formats for a locale. */

/** A number with thousands separators: "1,234", or with +options+ such as one decimal place. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString("en-US", options);
}

/** A count with its noun: "1 Finding", "6 Repositories". */
export function countLabel(count: number, noun: string, plural = `${noun}s`): string {
  return `${formatNumber(count)} ${count === 1 ? noun : plural}`;
}

/** +part+'s whole-number share of +whole+, from 0 to 100; 0 when there's no whole. */
export function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((Math.min(part, whole) / whole) * 100) : 0;
}

/** A size in bytes, in the largest unit that keeps it at 1 or more: "356 B", "3.5 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const [value, unit] = bytes < 1024 * 1024 ? [bytes / 1024, "KB"] : [bytes / (1024 * 1024), "MB"];
  return `${formatNumber(value, { maximumFractionDigits: 1 })} ${unit}`;
}
