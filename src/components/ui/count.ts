/** A count with its noun: "1 Finding", "6 Repositories". */
export function countLabel(count: number, noun: string, plural = `${noun}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? noun : plural}`;
}
