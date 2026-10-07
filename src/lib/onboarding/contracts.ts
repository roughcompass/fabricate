import { type JsonValue, compareCodeUnits, dump } from "@repo-facts/contract";

/*
 * Comparing revisions. Two versions of an onboarding document, such as two
 * Portal revisions or a v1 contract and its successor, are compared field by
 * field so a page can show what changed. Portal contracts and MFE runtime
 * contracts are no longer checked against one another: they were platform
 * policy the teams don't own, and they're kept only as v1 history.
 */

/** How a revision of a record names one of its documents, such as "Access revision 3 contract". */
export function contractLabel(name: string, revision: number, kind = "contract"): string {
  return `${name} revision ${revision} ${kind}`;
}

// ---------------------------------------------------------------------------
// Comparison

export interface ContractDifference {
  /** Where it differs, such as "modes.iframe.sandbox". */
  path: string;
  change: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
}

/**
 * The differences between two versions of a contract, as readable entries:
 * members added to or removed from each set, named items added or removed,
 * and values changed. Equal contracts have none.
 */
export function compareContracts(before: JsonValue | null, after: JsonValue | null): ContractDifference[] {
  return compareDocuments(before, after);
}

/** The differences between two versions of any onboarding document, such as two Portal revisions. */
export function compareDocuments(before: JsonValue | null, after: JsonValue | null): ContractDifference[] {
  const differences: ContractDifference[] = [];
  walk(before ?? null, after ?? null, "", differences);
  return differences.sort((a, b) => compareCodeUnits(a.path, b.path) || compareCodeUnits(a.change, b.change) || compareCodeUnits(a.before ?? a.after ?? "", b.before ?? b.after ?? ""));
}

function walk(before: JsonValue | null, after: JsonValue | null, path: string, out: ContractDifference[]): void {
  if (dump(before) === dump(after)) return;
  const isObject = (value: JsonValue | null): value is { [key: string]: JsonValue } => value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) walk(before[key] ?? null, after[key] ?? null, path ? `${path}.${key}` : key, out);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    // Items named by a name or a key, such as shared dependencies or environments, are matched by it.
    const field = [before, after].every((list) => list.every((item) => isObject(item) && typeof item.name === "string")) ? "name" : [before, after].every((list) => list.every((item) => isObject(item) && typeof item.key === "string")) ? "key" : null;
    if (field && (before.length > 0 || after.length > 0)) {
      const byName = (items: JsonValue[]) => new Map(items.map((item) => [String((item as Record<string, unknown>)[field]), item]));
      const was = byName(before);
      const is = byName(after);
      for (const name of new Set([...was.keys(), ...is.keys()])) walk(was.get(name) ?? null, is.get(name) ?? null, `${path}.${name}`, out);
      return;
    }
    const text = (items: JsonValue[]) => new Set(items.map((item) => (typeof item === "string" ? item : dump(item))));
    const was = text(before);
    const is = text(after);
    for (const item of is) if (!was.has(item)) out.push({ path, change: "added", before: null, after: item });
    for (const item of was) if (!is.has(item)) out.push({ path, change: "removed", before: item, after: null });
    return;
  }
  if (before === null) out.push({ path, change: "added", before: null, after: summary(after) });
  else if (after === null) out.push({ path, change: "removed", before: summary(before), after: null });
  else out.push({ path, change: "changed", before: summary(before), after: summary(after) });
}

function summary(value: JsonValue | null): string {
  return typeof value === "string" ? value : dump(value);
}
