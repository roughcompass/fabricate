/** A count with its noun: "1 Finding", "6 Sources". */
export function countLabel(count: number, noun: string, plural = `${noun}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? noun : plural}`;
}
