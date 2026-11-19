/**
 * Reading a page's query string and building addresses with one: a single
 * value, a value from a fixed set, a page number clamped to the pages there
 * are, and a search term (prune-and-consolidate-code, design decision 7).
 */

/** A page's query, as Next passes it. */
export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** Query parameters to write; an empty, null, or undefined value is left out. */
export type Query = Record<string, string | number | null | undefined>;

/** +name+'s value, the first of several, or undefined when it's absent. */
export function param(query: SearchParams, name: string): string | undefined {
  const value = query[name];
  return Array.isArray(value) ? value[0] : value;
}

/** +name+'s value when it's one of +choices+, else undefined. */
export function oneOf<T extends string>(query: SearchParams, name: string, choices: readonly T[]): T | undefined {
  const value = param(query, name);
  return choices.find((choice) => choice === value);
}

/** The page of +total+ items, +size+ to a page, to show: +requested+ clamped to the pages there are, or the first. A list always has a page. */
export function pageNumber(requested: string | number | undefined, total: number, size: number): { page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / size));
  const number = typeof requested === "number" ? requested : Number.parseInt(requested ?? "", 10);
  return { page: Number.isInteger(number) ? Math.min(Math.max(1, number), pages) : 1, pages };
}

/** A search term from +name+, trimmed and at most +maxLength+ characters; empty when there's none. */
export function searchTerm(query: SearchParams, name = "q", maxLength = 200): string {
  return (param(query, name) ?? "").trim().slice(0, maxLength);
}

/** +path+ with +query+'s values that are set, then +fragment+. */
export function withQuery(path: string, query: Query = {}, fragment?: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  return `${path}${params.size ? `?${params}` : ""}${fragment ? `#${fragment}` : ""}`;
}

/** A page number for an address: left out on the first page, so each page has one address. */
export function pageQuery(page: number): number | null {
  return page > 1 ? page : null;
}
