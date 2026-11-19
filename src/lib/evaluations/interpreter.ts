import { type JsonObject, type JsonValue, compareCodeUnits } from "@repo-facts/contract";
import semver from "semver";
import { LIMITS } from "@/lib/standards/document";
import type { Scope } from "@/lib/standards/registry";
import { asObject, asArray } from "@/lib/json";

/**
 * The typed three-valued interpreter for Standard expressions.
 *
 * Every predicate returns true, false, or unknown, and boolean composition
 * uses Kleene logic, so missing, conflicting, skipped, or incomplete evidence
 * can never collapse into a pass or a failure. Each evaluation returns a
 * trace: every node, the values it read, why a value is unknown, and the
 * evidence behind it.
 *
 * Operators are matched against a closed set of literals and selectors are
 * read by a closed switch; nothing in an expression is executed or used to
 * look up a property. The interpreter reads only deserialized, validated
 * Profile and Relationship Map documents: no Git, source reader, detector, or
 * network.
 */

export type Truth = "true" | "false" | "unknown";

export class EvaluationLimitError extends Error {
  override name = "EvaluationLimitError";
}

/** What a selector read: a value, whether a set or version list is complete, and why it is unknown. */
export interface Reading {
  known: boolean;
  /** A string, number, boolean, or null; for sets and versions, a list of strings. */
  value: JsonValue;
  /** For sets and versions: whether every member is known. */
  complete: boolean;
  /** For versions whose declarations conflict: each candidate's list. */
  alternatives?: string[][];
  reason: string | null;
  evidence: string[];
}

export interface TraceNode {
  op: string;
  result: Truth;
  selector?: string;
  parameter?: string;
  collection?: string;
  observed?: JsonValue;
  complete?: boolean;
  reason?: string;
  evidence: string[];
  children?: TraceNode[];
  items?: { subject: string; included: Truth; result: Truth; where?: TraceNode; trace?: TraceNode }[];
  count?: { definite: number; possible: number | null };
}

/** One subject an expression is read against, in a scope. */
export interface Context {
  scope: Scope;
  read(selector: string, parameter: string | undefined): Reading;
  collection(id: string): Collection;
}

interface Collection {
  items: { subject: string; context: Context }[];
  /** Items that may exist but were not observed, such as relationships from a repository without a Profile. */
  unseen: { reason: string; context: Context }[];
}

// ---------------------------------------------------------------------------
// Kleene logic

export function and(values: readonly Truth[]): Truth {
  if (values.includes("false")) return "false";
  return values.includes("unknown") ? "unknown" : "true";
}

export function or(values: readonly Truth[]): Truth {
  if (values.includes("true")) return "true";
  return values.includes("unknown") ? "unknown" : "false";
}

export function not(value: Truth): Truth {
  return value === "true" ? "false" : value === "false" ? "true" : "unknown";
}

const truth = (value: boolean): Truth => (value ? "true" : "false");

// ---------------------------------------------------------------------------
// Evaluation

export function evaluate(expression: JsonValue, context: Context, depth = 1): TraceNode {
  if (depth > LIMITS.depth) throw new EvaluationLimitError(`Expressions can nest at most ${LIMITS.depth} levels`);
  const node = asObject(expression);
  const op = node.op;
  switch (op) {
    case "always":
      return { op, result: "true", evidence: [] };
    case "all":
    case "any": {
      const items = asArray(node.items);
      if (items.length > LIMITS.items) throw new EvaluationLimitError(`A group can combine at most ${LIMITS.items} conditions`);
      const children = items.map((item) => evaluate(item, context, depth + 1));
      return { op, result: (op === "all" ? and : or)(children.map((child) => child.result)), evidence: [], children };
    }
    case "not": {
      const child = evaluate(node.item ?? null, context, depth + 1);
      return { op, result: not(child.result), evidence: [], children: [child] };
    }
    case "every":
    case "some":
    case "count":
      return quantify(node, context, depth);
    case "exists":
    case "equals":
    case "in":
    case "compare":
    case "contains":
    case "semver_satisfies":
      return predicate(node, context);
    default:
      throw new EvaluationLimitError(`Unsupported operator ${JSON.stringify(op ?? null)}`);
  }
}

function predicate(node: JsonObject, context: Context): TraceNode {
  const selector = String(node.selector);
  const parameter = typeof node.parameter === "string" ? node.parameter : undefined;
  const reading = context.read(selector, parameter);
  const base = { op: String(node.op), selector, ...(parameter !== undefined && { parameter }), observed: reading.value, evidence: reading.evidence, ...(Array.isArray(reading.value) && { complete: reading.complete }) };
  if (!reading.known) return { ...base, result: "unknown", reason: reading.reason ?? "The value is not established" };
  const result = test(node, reading);
  return { ...base, result, ...(result === "unknown" && { reason: reading.reason ?? "The evidence is incomplete, so the value may include members that were not seen" }) };
}

function test(node: JsonObject, reading: Reading): Truth {
  const value = reading.value;
  switch (node.op) {
    case "exists":
      // Conflicting declarations are still declarations.
      if (reading.alternatives?.some((candidate) => candidate.length > 0)) return "true";
      if (Array.isArray(value)) return value.length ? "true" : reading.complete ? "false" : "unknown";
      return truth(value !== null);
    case "equals":
      return truth(value === node.value);
    case "in":
      return truth(typeof value === "string" && asArray(node.values).includes(value));
    case "compare":
      return typeof value === "number" ? truth(compare(value, String(node.comparator), Number(node.value))) : "false";
    case "contains": {
      const members = Array.isArray(value) ? value.map(String) : [];
      const wanted = asArray(node.values).map(String);
      const present = wanted.filter((item) => members.includes(item));
      if (node.mode === "all") return present.length === wanted.length ? "true" : reading.complete ? "false" : "unknown";
      return present.length ? "true" : reading.complete ? "false" : "unknown";
    }
    case "semver_satisfies": {
      const range = String(node.range);
      const candidates = reading.alternatives ?? [Array.isArray(value) ? value.map(String) : []];
      // Conflicting declarations decide the result only when every candidate agrees.
      const results = candidates.map((versions) => satisfies(versions, range, reading.complete));
      return results.every((result) => result === "true") ? "true" : results.every((result) => result === "false") ? "false" : "unknown";
    }
    default:
      return "unknown";
  }
}

/** Every version satisfies the range, and every declared range lies within it. */
function satisfies(versions: readonly string[], range: string, complete: boolean): Truth {
  if (!versions.length) return complete ? "false" : "unknown";
  const results = versions.map((version): Truth => {
    if (semver.valid(version)) return truth(semver.satisfies(version, range));
    if (semver.validRange(version)) return truth(semver.subset(version, range));
    return "unknown";
  });
  return and(results);
}

function compare(value: number, comparator: string, target: number): boolean {
  switch (comparator) {
    case "eq":
      return value === target;
    case "lt":
      return value < target;
    case "lte":
      return value <= target;
    case "gt":
      return value > target;
    case "gte":
      return value >= target;
    default:
      return false;
  }
}

function quantify(node: JsonObject, context: Context, depth: number): TraceNode {
  const op = String(node.op);
  const id = String(node.collection);
  const collection = context.collection(id);
  const where = node.where === undefined ? null : node.where;
  const items = collection.items.map((item) => {
    const filtered = where === null ? null : evaluate(where, item.context, depth + 1);
    const included: Truth = filtered ? filtered.result : "true";
    const trace = op === "count" || included === "false" ? undefined : evaluate(node.condition ?? null, item.context, depth + 1);
    return { subject: item.subject, included, result: trace ? trace.result : included, ...(filtered && { where: filtered }), ...(trace && { trace }) };
  });
  // An unseen item matters only if the filter could include it.
  const relevant = collection.unseen.filter((unseen) => (where === null ? true : evaluate(where, unseen.context, depth + 1).result !== "false"));
  const unseenReason = relevant.length ? relevant.map((unseen) => unseen.reason).join("; ") : undefined;

  if (op === "count") {
    const definite = items.filter((item) => item.included === "true").length;
    const possible = relevant.length ? null : items.filter((item) => item.included === "unknown").length;
    const comparator = String(node.comparator);
    const target = Number(node.value);
    const result = possible === null ? unboundedResult(definite, comparator, target) : rangeResult(definite, definite + possible, comparator, target);
    return { op, collection: id, result, evidence: [], count: { definite, possible }, items: items.map(({ trace: _trace, ...item }) => item), ...(result === "unknown" && { reason: unseenReason ?? "Some items may or may not match the filter" }) };
  }

  // every = AND over items of (included → condition); some = OR over items of (included ∧ condition).
  const terms = items.map((item) => (op === "every" ? or([not(item.included), item.trace ? item.trace.result : "true"]) : and([item.included, item.trace ? item.trace.result : "false"])));
  const unseenTerm: Truth[] = relevant.length ? ["unknown"] : [];
  const result = op === "every" ? and([...terms, ...unseenTerm]) : or([...terms, ...unseenTerm]);
  const decidedByUnseen = result === "unknown" && relevant.length > 0 && !terms.includes("unknown");
  return { op, collection: id, result, evidence: [], items, ...(decidedByUnseen && { reason: unseenReason }) };
}

/** A comparison over every count from +low+ upward, when unseen items leave no upper bound. */
function unboundedResult(low: number, comparator: string, target: number): Truth {
  switch (comparator) {
    case "gt":
    case "gte":
      // More items can only keep a lower bound true.
      return compare(low, comparator, target) ? "true" : "unknown";
    case "eq":
    case "lte":
      return low > target ? "false" : "unknown";
    case "lt":
      return low >= target ? "false" : "unknown";
    default:
      return "unknown";
  }
}

/** A comparison over every count between +low+ and +high+: decided only when all agree. */
function rangeResult(low: number, high: number, comparator: string, target: number): Truth {
  let seenTrue = false;
  let seenFalse = false;
  for (let count = low; count <= high; count++) {
    if (compare(count, comparator, target)) seenTrue = true;
    else seenFalse = true;
    if (seenTrue && seenFalse) return "unknown";
  }
  return seenTrue ? "true" : "false";
}

/** Every unknown leaf in a trace, with its reason: what prevented a decision. */
export function unknownCauses(trace: TraceNode): { selector: string | null; parameter: string | null; collection: string | null; reason: string }[] {
  const causes = new Map<string, { selector: string | null; parameter: string | null; collection: string | null; reason: string }>();
  const visit = (node: TraceNode) => {
    if (node.result !== "unknown") return;
    if (node.reason) {
      const cause = { selector: node.selector ?? null, parameter: node.parameter ?? null, collection: node.collection ?? null, reason: node.reason };
      causes.set(JSON.stringify(cause), cause);
    }
    for (const child of node.children ?? []) visit(child);
    for (const item of node.items ?? []) {
      if (item.where) visit(item.where);
      if (item.trace) visit(item.trace);
    }
  };
  visit(trace);
  return [...causes.values()].sort((a, b) => compareCodeUnits(JSON.stringify(a), JSON.stringify(b)));
}

/** Every evidence identifier a trace cites. */
export function traceEvidence(trace: TraceNode): string[] {
  const found = new Set<string>();
  const visit = (node: TraceNode) => {
    for (const id of node.evidence) found.add(id);
    for (const child of node.children ?? []) visit(child);
    for (const item of node.items ?? []) {
      if (item.where) visit(item.where);
      if (item.trace) visit(item.trace);
    }
  };
  visit(trace);
  return [...found].sort(compareCodeUnits);
}
