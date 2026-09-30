import { type JsonValue, compareCodeUnits, dump, sha256 } from "@repo-facts/contract";

/**
 * The canonical form and digest of a Standard document, for drafts and
 * Releases alike.
 *
 * Equivalent documents canonicalize identically: Controls are ordered by key,
 * the items of `all` and `any` and the values of `in` and `contains` are
 * ordered (and values deduplicated), declared schema versions are ordered and
 * deduplicated, and object keys are sorted by canonical JSON. Anything else is
 * kept as written, so an invalid draft still has a stable digest.
 *
 * The input may hold hostile keys such as `__proto__` or `constructor`. Every
 * object is rebuilt with data-property creation from its own keys, and no
 * value is ever used to look up a property on an ordinary object, so such
 * keys stay inert data.
 */

export function canonicalStandard(document: JsonValue): JsonValue {
  if (!isRecord(document)) return canonicalValue(document);
  return rebuild(document, (key, value) => {
    if (key === "controls" && Array.isArray(value)) return sortBy(value.map(canonicalControl), (control) => (isRecord(control) && typeof control.key === "string" ? control.key : ""));
    if (key === "input_schemas" && isRecord(value)) return rebuild(value, (_name, versions) => (Array.isArray(versions) ? uniqueSorted(versions) : canonicalValue(versions)));
    return canonicalValue(value);
  });
}

/** SHA-256 of the canonical form. */
export function standardDigest(document: JsonValue): string {
  return sha256(dump(canonicalStandard(document)));
}

function canonicalControl(control: JsonValue): JsonValue {
  if (!isRecord(control)) return canonicalValue(control);
  return rebuild(control, (key, value) => (key === "applicability" || key === "condition" ? canonicalExpression(value) : canonicalValue(value)));
}

function canonicalExpression(expression: JsonValue): JsonValue {
  if (!isRecord(expression)) return canonicalValue(expression);
  const op = expression.op;
  return rebuild(expression, (key, value) => {
    if ((key === "item" || key === "where" || key === "condition") && isRecord(value)) return canonicalExpression(value);
    if (key === "items" && Array.isArray(value)) {
      const items = value.map(canonicalExpression);
      // `all` and `any` are commutative, so their items have one canonical order.
      return op === "all" || op === "any" ? sortBy(items, (item) => dump(item)) : items;
    }
    if (key === "values" && Array.isArray(value) && (op === "in" || op === "contains") && value.every((item) => typeof item === "string")) return uniqueSorted(value);
    return canonicalValue(value);
  });
}

/** A copy with every object rebuilt from its own keys; canonical JSON sorts the keys when it is written. */
function canonicalValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) return rebuild(value, (_key, item) => canonicalValue(item));
  return value;
}

type Record_ = { readonly [key: string]: JsonValue };

function rebuild(value: Record_, map: (key: string, value: JsonValue) => JsonValue): JsonValue {
  // Object.fromEntries defines own data properties, so a "__proto__" key never reaches a prototype.
  return Object.fromEntries(Object.keys(value).map((key) => [key, map(key, value[key]!)])) as JsonValue;
}

function sortBy(values: JsonValue[], key: (value: JsonValue) => string): JsonValue[] {
  return values.map((value) => ({ value, key: key(value), text: dump(value) })).sort((a, b) => compareCodeUnits(a.key, b.key) || compareCodeUnits(a.text, b.text)).map((item) => item.value);
}

function uniqueSorted(values: JsonValue[]): JsonValue[] {
  const seen = new Map<string, JsonValue>();
  for (const value of values) seen.set(dump(value), value);
  return [...seen.entries()].sort(([a], [b]) => compareCodeUnits(a, b)).map(([, value]) => value);
}

function isRecord(value: JsonValue | undefined): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
