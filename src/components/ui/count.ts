/** A count with its noun: "1 Finding", "6 Repositories". */
export function countLabel(count: number, noun: string, plural = `${noun}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? noun : plural}`;
}

/** A size in bytes, in the largest unit that keeps it at 1 or more: "356 B", "3.5 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const [value, unit] = bytes < 1024 * 1024 ? [bytes / 1024, "KB"] : [bytes / (1024 * 1024), "MB"];
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unit}`;
}
