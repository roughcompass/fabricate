/** +items+ as a sentence lists them: "a", "a and b", or "a, b, and c". */
export function list(items: readonly string[], conjunction: "and" | "or" = "and"): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items.at(-1)}`;
}
