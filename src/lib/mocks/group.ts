import { MATCH_BODY_LIMIT } from "./compiled";
import { jsonEqual, parsePattern, patternText } from "./engine";
import type { MockBodyMode, MockQueryMode } from "@/lib/db/schema";
import { RESPONSE_LIMIT } from "./model";
import { type Removed, type SanitizedBody, type SanitizedCall, addRemoved, isMultipartType, noneRemoved } from "./sanitize";

/*
 * Grouping an upload's calls into rules (add-mock-sets, design decisions 5
 * and 12, step 6; mock-set-import spec, "Identical calls become one rule
 * with their responses in order" and "The review lists the hosts recorded").
 * Calls are taken in recorded order. A call's group is its method, origin,
 * path, query as it will be matched, and body as it will be matched, so
 * grouping runs twice: first to find the query parameters whose values
 * differ between otherwise identical calls, which are cache busters, and the
 * bodies that differ between calls to one address, then with the matching
 * settled. Paths stay literal: nothing infers `:id`. An entry an export
 * wrote restores its rule as it was (decision 13).
 */

export interface DraftResponse {
  readonly status: number;
  readonly headers: readonly [string, string][];
  readonly body: SanitizedBody | null;
  readonly latencyMs: number;
}

export interface DraftRule {
  readonly method: string;
  readonly origin: string;
  readonly pattern: string;
  readonly queryMode: MockQueryMode;
  readonly query: readonly [string, string][];
  readonly queryIgnored: readonly string[];
  readonly bodyMode: MockBodyMode;
  readonly body: SanitizedBody | null;
  readonly responses: readonly DraftResponse[];
  /** How many calls it groups. */
  readonly calls: number;
  /** Responses past 20 that weren't kept: it keeps the first 19 and the last. */
  readonly dropped: number;
  readonly removed: Removed;
  /** Whether a body of it couldn't be checked for credentials or personal data. */
  readonly binary: boolean;
  /** Whether it's turned on: always, unless an export recorded it off. */
  readonly enabled: boolean;
}

export interface HostsSuggestion {
  /** Each origin recorded, in recorded order, with how many kept calls it has. */
  readonly origins: readonly { readonly origin: string; readonly calls: number }[];
  /** Any host, unless two origins recorded one method and path with different responses. */
  readonly mode: "any" | "mapped";
  /** The method and path two origins answered differently, such as `GET /v1/config`. */
  readonly conflicts: readonly string[];
}

/** A rule an export wrote, restored exactly (export.ts). */
interface Restored {
  readonly rule: string;
  /** Its method, `*` for any, which the entry's own method can't say. */
  readonly method: string | null;
  readonly pattern: string;
  readonly queryMode: MockQueryMode;
  readonly ignored: readonly string[];
  readonly bodyMode: MockBodyMode;
  readonly enabled: boolean;
  readonly position: number;
}

const QUERY_MODES = new Set(["exact", "ignore_listed", "ignore_all"]);
const BODY_MODES = new Set(["ignore", "exact", "json"]);

function restoredOf(value: unknown): Restored | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record || typeof record.rule !== "string" || typeof record.pattern !== "string" || !parsePattern(record.pattern)) return null;
  if (!QUERY_MODES.has(String(record.queryMode)) || !BODY_MODES.has(String(record.bodyMode))) return null;
  return {
    rule: record.rule,
    method: typeof record.method === "string" && /^(\*|[A-Z]{1,20})$/.test(record.method) ? record.method : null,
    pattern: record.pattern,
    queryMode: record.queryMode as MockQueryMode,
    ignored: Array.isArray(record.ignored) ? record.ignored.filter((name): name is string => typeof name === "string") : [],
    bodyMode: record.bodyMode as MockBodyMode,
    enabled: record.enabled !== false,
    position: Number.isFinite(Number(record.position)) ? Number(record.position) : 0,
  };
}

/** A body's text, or null when it's binary. */
const textOf = (body: SanitizedBody | null) => (body && !body.binary ? new TextDecoder().decode(body.bytes) : null);

/** Whether a request body can be compared: text of at most 64 KB, nothing redacted in it, and not multipart. */
function comparable(body: SanitizedBody | null): boolean {
  return !!body && !body.binary && !body.changed && body.bytes.byteLength > 0 && body.bytes.byteLength <= MATCH_BODY_LIMIT && !isMultipartType(body.type);
}

function parsedJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

interface Parsed {
  readonly call: SanitizedCall;
  readonly origin: string;
  readonly path: string;
  readonly params: [string, string][];
  readonly restored: Restored | null;
}

const pairsKey = (pairs: readonly (readonly [string, string])[]) => JSON.stringify([...pairs].map(([name, value]) => `${name}=${value}`).sort());

/** Names cache busters commonly have. */
const BUSTER_NAME = /^(_|_t|t|ts|timestamp|cb|cachebust(er)?|nocache|nonce|rand(om)?)$/i;
/** A value shaped like a timestamp in seconds or milliseconds. */
const TIMESTAMP = /^\d{10,13}$/;

/** A call's first answer, to tell whether two calls were answered alike. */
const answerOf = (call: Parsed) => `${call.call.status}:${textOf(call.call.responseBody) ?? call.call.responseBody?.bytes.byteLength ?? ""}`;

/**
 * The parameters of one address whose values differ between calls that are
 * otherwise identical, by the rest of their query and their body: cache
 * busters. A parameter whose values were answered differently is kept, so
 * paging stays apart, unless its name or its values say it's a cache
 * buster, as a timestamp added to each poll of an export does.
 */
function cacheBusters(calls: readonly Parsed[]): Set<string> {
  const busters = new Set<string>();
  const names = new Set(calls.flatMap((call) => call.params.map(([name]) => name)));
  for (const name of names) {
    const seen = new Map<string, Parsed>();
    for (const call of calls) {
      const values = call.params.filter(([key]) => key === name).map(([, value]) => value);
      if (values.length !== 1) continue;
      const rest = `${pairsKey(call.params.filter(([key]) => key !== name))}|${textOf(call.call.requestBody) ?? ""}`;
      const earlier = seen.get(rest);
      if (!earlier) {
        seen.set(rest, call);
        continue;
      }
      const before = earlier.params.find(([key]) => key === name)![1];
      if (before === values[0]) continue;
      if (answerOf(earlier) === answerOf(call) || BUSTER_NAME.test(name) || (TIMESTAMP.test(before) && TIMESTAMP.test(values[0]!))) busters.add(name);
    }
  }
  return busters;
}

/** A group's responses, up to 20: the first 19 and the last. */
function capped(responses: DraftResponse[]): { kept: DraftResponse[]; dropped: number } {
  if (responses.length <= RESPONSE_LIMIT) return { kept: responses, dropped: 0 };
  return { kept: [...responses.slice(0, RESPONSE_LIMIT - 1), responses.at(-1)!], dropped: responses.length - RESPONSE_LIMIT };
}

const responseOf = (call: SanitizedCall): DraftResponse => ({ status: call.status, headers: call.responseHeaders, body: call.responseBody, latencyMs: call.latencyMs });

/** One rule from the calls of one group, in recorded order. */
function ruleOf(calls: readonly Parsed[], matching: { queryMode: MockQueryMode; query: [string, string][]; ignored: string[]; bodyMode: MockBodyMode; body: SanitizedBody | null; pattern: string; enabled: boolean }): DraftRule {
  const first = calls[0]!;
  const { kept, dropped } = capped(calls.map((call) => responseOf(call.call)));
  const removed = noneRemoved();
  for (const call of calls) addRemoved(removed, call.call.removed);
  return {
    method: first.call.method,
    origin: first.origin,
    pattern: matching.pattern,
    queryMode: matching.queryMode,
    query: matching.query,
    queryIgnored: matching.ignored,
    bodyMode: matching.bodyMode,
    body: matching.bodyMode === "ignore" ? null : matching.body,
    responses: kept,
    calls: calls.length,
    dropped,
    removed,
    binary: calls.some((call) => call.call.responseBody?.binary || call.call.requestBody?.binary),
    enabled: matching.enabled,
  };
}

/** Rules restored from an export's own entries, by the rule each names, in the set's order. */
function restoredRules(parsed: readonly Parsed[]): DraftRule[] {
  const groups = new Map<string, Parsed[]>();
  for (const call of parsed) groups.set(call.restored!.rule, [...(groups.get(call.restored!.rule) ?? []), call]);
  return [...groups.values()]
    .sort((left, right) => left[0]!.restored!.position - right[0]!.restored!.position)
    .map((calls) => {
      const restored = calls[0]!.restored!;
      const body = calls[0]!.call.requestBody;
      const rule = ruleOf(calls, { queryMode: restored.queryMode, query: calls[0]!.params, ignored: [...restored.ignored], bodyMode: body ? restored.bodyMode : "ignore", body, pattern: restored.pattern, enabled: restored.enabled });
      return restored.method ? { ...rule, method: restored.method } : rule;
    });
}

/** The literal pattern of a recorded path: each segment as it is, never a named part. */
function literalPattern(path: string): string {
  return patternText({ segments: path.split("/").filter(Boolean).map((segment) => ({ literal: safeDecode(segment) })), rest: false });
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Calls to one method and address grouped into rules, with their matching settled, each with when its first call was made. */
function addressRules(calls: readonly Parsed[]): { rule: DraftRule; first: Parsed }[] {
  const busters = cacheBusters(calls);
  const ignored = new Set([...busters, ...calls.flatMap((call) => call.call.redactedParams)]);
  const matchedQuery = (call: Parsed) => call.params.filter(([name]) => !ignored.has(name));
  // Bodies are compared when calls with one query sent different bodies.
  const bodiesByQuery = new Map<string, Set<string>>();
  for (const call of calls) {
    if (!comparable(call.call.requestBody)) continue;
    const key = pairsKey(matchedQuery(call));
    bodiesByQuery.set(key, (bodiesByQuery.get(key) ?? new Set()).add(textOf(call.call.requestBody)!));
  }
  const compared = (call: Parsed) => comparable(call.call.requestBody) && (bodiesByQuery.get(pairsKey(matchedQuery(call)))?.size ?? 0) > 1;
  const groups: { key: string; calls: Parsed[] }[] = [];
  for (const call of calls) {
    const body = compared(call) ? textOf(call.call.requestBody)! : null;
    const json = body === null ? undefined : parsedJson(body);
    const key = `${pairsKey(matchedQuery(call))}|${body === null ? "" : json === undefined ? `exact:${body}` : "json"}`;
    const group = groups.find((candidate) => candidate.key === key && (json === undefined || jsonEqual(parsedJson(textOf(candidate.calls[0]!.call.requestBody)), json)));
    if (group) group.calls.push(call);
    else groups.push({ key, calls: [call] });
  }
  return groups.map(({ calls: grouped }) => {
    const first = grouped[0]!;
    const body = compared(first) ? first.call.requestBody : null;
    const bodyMode: MockBodyMode = body ? (parsedJson(textOf(body)) === undefined ? "exact" : "json") : "ignore";
    const listed = [...ignored].filter((name) => grouped.some((call) => call.params.some(([key]) => key === name))).sort();
    return { rule: ruleOf(grouped, { queryMode: listed.length ? "ignore_listed" : "exact", query: matchedQuery(first), ignored: listed, bodyMode, body, pattern: literalPattern(first.path), enabled: true }), first };
  });
}

/** The hosts the kept calls were recorded on, and whether the set needs mapped hosts. */
function hostsOf(rules: readonly DraftRule[]): HostsSuggestion {
  const origins = new Map<string, number>();
  for (const rule of rules) origins.set(rule.origin, (origins.get(rule.origin) ?? 0) + rule.calls);
  const answers = new Map<string, Map<string, string>>();
  for (const rule of rules) {
    const key = `${rule.method} ${rule.pattern}`;
    const first = rule.responses[0];
    const answer = first ? `${first.status}:${textOf(first.body) ?? first.body?.bytes.byteLength ?? ""}` : "";
    const byOrigin = answers.get(key) ?? new Map<string, string>();
    if (!byOrigin.has(rule.origin)) byOrigin.set(rule.origin, answer);
    answers.set(key, byOrigin);
  }
  const conflicts = [...answers.entries()].filter(([, byOrigin]) => byOrigin.size > 1 && new Set(byOrigin.values()).size > 1).map(([key]) => key);
  return { origins: [...origins.entries()].map(([origin, calls]) => ({ origin, calls })), mode: conflicts.length ? "mapped" : "any", conflicts };
}

/**
 * Groups sanitized +calls+ into rules: identical calls into one rule with
 * their responses in recorded order, up to 20, in the order each rule's
 * first call was made. Returns them with the hosts suggestion.
 */
export function groupCalls(calls: readonly SanitizedCall[]): { rules: DraftRule[]; hosts: HostsSuggestion } {
  const parsed = [...calls]
    .sort((left, right) => left.startedAt - right.startedAt || left.index - right.index)
    .map((call): Parsed => {
      const url = new URL(call.url);
      return { call, origin: url.origin, path: url.pathname, params: [...url.searchParams.entries()], restored: restoredOf(call.frontendRegistry) };
    });
  const restored = restoredRules(parsed.filter((call) => call.restored));
  const addresses = new Map<string, Parsed[]>();
  for (const call of parsed.filter((each) => !each.restored)) {
    const key = `${call.call.method} ${call.origin}${call.path.replace(/\/+$/, "")}`;
    addresses.set(key, [...(addresses.get(key) ?? []), call]);
  }
  // Rules in the order their first call was made; calls are in recorded order, so a group's first is its earliest.
  const ordered = [...addresses.values()]
    .flatMap((group) => addressRules(group))
    .sort((left, right) => parsed.indexOf(left.first) - parsed.indexOf(right.first))
    .map((entry) => entry.rule);
  const rules = [...restored, ...ordered];
  return { rules, hosts: hostsOf(rules) };
}
