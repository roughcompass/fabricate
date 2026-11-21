import { type CompiledBodyMatch, type CompiledPath, type CompiledQuery, type CompiledResponse, type CompiledRule, type CompiledSet, type HostMatching, MATCH_BODY_LIMIT, MOCK_HEADER, type PatternSegment, SELF_ORIGIN } from "./compiled";

/*
 * The matching engine (add-mock-sets, design decisions 4 to 8; mock-sets
 * spec): which rule of a set answers a call, and with which response. It's
 * pure, with no Node, DOM, or React dependency, so the routing worker, the
 * screenshot capture, and the tests run the same code. Each caller decides
 * for itself whether a call is API-like and whether the build answers first,
 * under its base; the engine only matches what it's given.
 */

/** A call to match: its method, its absolute address, and its body as text, when it has one. */
export interface MockCall {
  readonly method: string;
  readonly url: string;
  /** The request body decoded as text; null or absent when it has none or it couldn't be read. */
  readonly body?: string | null;
}

export interface MatchContext {
  /** The Frontend Registry's own origin, which `self` stands for and relative calls use. */
  readonly origin: string;
  /** The build's base path, `/previews/<build>/`: a call under it is matched by the part after it. */
  readonly base: string | null;
}

/** How many calls each rule has answered since the frame's document loaded, by rule ID. A caller resets it by starting a new one. */
export type Sequences = Map<string, number>;

export type MatchResult =
  /** The Frontend Registry's own paths, which no rule answers. */
  | { readonly kind: "skip" }
  | { readonly kind: "unmatched" }
  /** The rule that answers, and its response with that response's index, from 0. */
  | { readonly kind: "rule"; readonly rule: CompiledRule; readonly index: number; readonly response: CompiledResponse };

/** Paths on the Frontend Registry's own origin that are never matched: its toolbar, its pages' files, and every build's files. */
const OWN_PATHS = ["/toolbar/", "/_next/", "/previews/"];

const PARAM = /^:([A-Za-z_][A-Za-z0-9_]*)$/;

/** +segment+ percent-decoded, or as it is when it isn't valid percent-encoding. */
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A path's segments, percent-decoded, without empty ones, so a trailing slash doesn't matter. */
export function pathSegments(path: string): string[] {
  return path
    .split("/")
    .filter((segment) => segment !== "")
    .map(decoded);
}

/**
 * A pattern such as `/v1/accounts/:id` or `/v1/files/*` parsed into its
 * segments, or null when it isn't one: it starts with `/`, names each part
 * with letters, digits, and underscores, and has `*` only at its end.
 */
export function parsePattern(pattern: string): CompiledPath | null {
  if (!pattern.startsWith("/") || /[?#\s]/.test(pattern)) return null;
  const raw = pattern.split("/").filter((segment) => segment !== "");
  const rest = raw.at(-1) === "*";
  const parts = rest ? raw.slice(0, -1) : raw;
  const segments: PatternSegment[] = [];
  for (const part of parts) {
    if (part === "*") return null;
    if (part.startsWith(":")) {
      const name = PARAM.exec(part)?.[1];
      if (!name) return null;
      segments.push({ param: name });
    } else segments.push({ literal: decoded(part) });
  }
  return { segments, rest };
}

/** A parsed pattern written out again, as `parsePattern` reads it. */
export function patternText(path: CompiledPath): string {
  const parts = path.segments.map((segment) => ("param" in segment ? `:${segment.param}` : encodeURIComponent(segment.literal)));
  if (path.rest) parts.push("*");
  return `/${parts.join("/")}`;
}

/** Whether +segments+, a call's path, fits +path+. */
function pathMatches(path: CompiledPath, segments: readonly string[]): boolean {
  if (path.rest ? segments.length <= path.segments.length : segments.length !== path.segments.length) return false;
  return path.segments.every((segment, index) => "param" in segment || segment.literal === segments[index]);
}

/** +origin+ as `URL.origin` writes it, lowercased without a default port, or as it is when it isn't one. */
export function normalizedOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    return parsed.origin === "null" ? origin : parsed.origin;
  } catch {
    return origin;
  }
}

/** The origin a rule recorded on matches in +hosts+: the mapped one, `self` resolved, or itself when unmapped. */
function mappedOrigin(origin: string, hosts: HostMatching, context: MatchContext): string {
  if (hosts.mode !== "mapped") return origin;
  const mapping = hosts.map.find((candidate) => normalizedOrigin(candidate.from) === origin);
  if (!mapping) return origin;
  return mapping.to === SELF_ORIGIN ? context.origin : normalizedOrigin(mapping.to);
}

function originMatches(rule: CompiledRule, hosts: HostMatching, context: MatchContext, origin: string): boolean {
  if (hosts.mode === "any" || rule.origin === null) return true;
  return mappedOrigin(normalizedOrigin(rule.origin), hosts, context) === normalizedOrigin(origin);
}

/** Whether two lists of name and value pairs hold the same pairs, in any order. */
function samePairs(left: readonly (readonly [string, string])[], right: readonly (readonly [string, string])[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  const key = ([name, value]: readonly [string, string]) => `${name.length}:${name}=${value}`;
  for (const pair of left) counts.set(key(pair), (counts.get(key(pair)) ?? 0) + 1);
  for (const pair of right) {
    const held = counts.get(key(pair));
    if (!held) return false;
    counts.set(key(pair), held - 1);
  }
  return true;
}

function queryMatches(query: CompiledQuery, search: URLSearchParams): boolean {
  if (query.mode === "ignore-all") return true;
  const ignored = query.mode === "ignore-listed" ? new Set(query.ignored) : new Set<string>();
  const kept = (pairs: Iterable<readonly [string, string]>) => [...pairs].filter(([name]) => !ignored.has(name));
  return samePairs(kept(query.params), kept(search.entries()));
}

/** Whether two parsed JSON values are equal: object members in any order, arrays in order, numbers by value. */
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => jsonEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightObject = right as Record<string, unknown>;
  if (leftKeys.length !== Object.keys(rightObject).length) return false;
  return leftKeys.every((key) => Object.hasOwn(rightObject, key) && jsonEqual((left as Record<string, unknown>)[key], rightObject[key]));
}

/** +text+'s length in UTF-8 bytes. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** A body the rules can compare: at most MATCH_BODY_LIMIT bytes, or null. */
function comparableBody(body: string | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  return body.length > MATCH_BODY_LIMIT || utf8Length(body) > MATCH_BODY_LIMIT ? null : body;
}

/** The parsed body, or undefined when it isn't JSON. */
function parsedJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function bodyMatches(match: CompiledBodyMatch, body: string | null): boolean {
  if (match.mode === "ignore") return true;
  if (body === null) return false;
  if (match.mode === "exact") return body === match.text;
  const value = parsedJson(body);
  return value !== undefined && jsonEqual(match.value, value);
}

/** Whether +rule+ answers a call of +method+ to +origin+ and +segments+, with +search+ and +body+. */
function ruleMatches(rule: CompiledRule, set: CompiledSet, context: MatchContext, call: { method: string; origin: string; segments: string[]; search: URLSearchParams; body: string | null }): boolean {
  return (
    (rule.method === null || rule.method === call.method) &&
    originMatches(rule, set.hosts, context, call.origin) &&
    pathMatches(rule.path, call.segments) &&
    queryMatches(rule.query, call.search) &&
    bodyMatches(rule.body, call.body) &&
    rule.responses.length > 0
  );
}

/**
 * The path a call is matched by, or null for the Frontend Registry's own
 * paths: under the build's base, the part after it; anything else on the
 * Frontend Registry's origin as it is, apart from its toolbar, its pages'
 * files, and every build's files.
 */
export function matchedPath(url: URL, context: MatchContext): string | null {
  if (url.origin !== normalizedOrigin(context.origin)) return url.pathname;
  const base = context.base?.replace(/\/?$/, "/");
  if (base && (url.pathname === base.slice(0, -1) || url.pathname.startsWith(base))) return `/${url.pathname.slice(base.length)}`;
  return OWN_PATHS.some((own) => url.pathname.startsWith(own)) ? null : url.pathname;
}

/**
 * The rule of +set+ that answers +call+, and its next response, counting the
 * call in +sequences+: the k-th call a rule answers gets response min(k, n).
 * Rules are in precedence order, so the first that matches answers. A call to
 * the Frontend Registry's own paths is skipped.
 */
export function match(set: CompiledSet, call: MockCall, context: MatchContext, sequences: Sequences): MatchResult {
  let url: URL;
  try {
    url = new URL(call.url);
  } catch {
    return { kind: "unmatched" };
  }
  const path = matchedPath(url, context);
  if (path === null) return { kind: "skip" };
  const candidate = { method: call.method.toUpperCase(), origin: url.origin, segments: pathSegments(path), search: url.searchParams, body: comparableBody(call.body) };
  const rule = set.rules.find((item) => ruleMatches(item, set, context, candidate));
  if (!rule) return { kind: "unmatched" };
  const answered = (sequences.get(rule.id) ?? 0) + 1;
  sequences.set(rule.id, answered);
  const index = Math.min(answered, rule.responses.length) - 1;
  return { kind: "rule", rule, index, response: rule.responses[index]! };
}

/** An answer to give without a stored body: the 501 for a call no rule matched. */
export interface PlainAnswer {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

/** The answer to a call no rule of +set+ matches, when the set answers them as not mocked (design decision 8). */
export function notMocked(set: Pick<CompiledSet, "name">, call: Pick<MockCall, "method" | "url">): PlainAnswer {
  return {
    status: 501,
    headers: [
      ["Content-Type", "application/json"],
      [MOCK_HEADER, "not-matched"],
    ],
    body: JSON.stringify({ error: "Not mocked", set: set.name, method: call.method.toUpperCase(), url: call.url }),
  };
}

/** Statuses whose answers have no body, which a `Response` refuses one for. */
export const BODILESS_STATUSES: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

/** A response's headers to answer with: its own, then its content type. */
export function answerHeaders(response: CompiledResponse): [string, string][] {
  const headers = response.headers.map(([name, value]): [string, string] => [name, value]);
  if (response.contentType && !headers.some(([name]) => name.toLowerCase() === "content-type")) headers.push(["Content-Type", response.contentType]);
  return headers;
}

/** An inline body's bytes. */
export function inlineBytes(body: { readonly inline: string; readonly base64: boolean }): Uint8Array {
  if (!body.base64) return new TextEncoder().encode(body.inline);
  const binary = atob(body.inline);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** The Data tool's latency for mocked answers: none, each response's own up to 10 seconds, or 2 seconds (mock-data spec, "Data offers a latency"). */
export type LatencySetting = "off" | "recorded" | "slow";

export const RECORDED_LATENCY_LIMIT_MS = 10_000;
export const SLOW_LATENCY_MS = 2_000;

/** How long to wait before answering with +response+ under +setting+. Screenshots answer at once. */
export function latencyFor(response: Pick<CompiledResponse, "latencyMs">, setting: LatencySetting): number {
  if (setting === "slow") return SLOW_LATENCY_MS;
  if (setting === "recorded") return Math.max(0, Math.min(response.latencyMs, RECORDED_LATENCY_LIMIT_MS));
  return 0;
}

/** The order rules compare in, most specific first (design decision 6), as six keys, each higher when more specific. */
export function specificity(rule: Pick<CompiledRule, "method" | "origin" | "path" | "query" | "body">, hosts: HostMatching): number[] {
  return [
    rule.method === null ? 0 : 1,
    hosts.mode === "mapped" && rule.origin !== null ? 1 : 0,
    rule.path.segments.filter((segment) => "literal" in segment).length,
    rule.path.rest ? 0 : 1,
    { exact: 2, "ignore-listed": 1, "ignore-all": 0 }[rule.query.mode],
    rule.body.mode === "ignore" ? 0 : 1,
  ];
}

function compareSpecificity(left: number[], right: number[]): number {
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return (right[index] ?? 0) - (left[index] ?? 0);
  return 0;
}

/** +rules+, in the set's order, sorted most specific first, keeping the set's order between equally specific rules. */
export function inPrecedenceOrder<T extends Pick<CompiledRule, "method" | "origin" | "path" | "query" | "body">>(rules: readonly T[], hosts: HostMatching): T[] {
  return rules
    .map((rule, position) => ({ rule, position, key: specificity(rule, hosts) }))
    .sort((left, right) => compareSpecificity(left.key, right.key) || left.position - right.position)
    .map((entry) => entry.rule);
}

/**
 * A rule's request side as one string: two rules with the same key match the
 * same calls, so the later of them in precedence order is never reached.
 */
export function requestKey(rule: Pick<CompiledRule, "method" | "origin" | "path" | "query" | "body">, hosts: HostMatching): string {
  const query = rule.query.mode === "ignore-all" ? [] : [...rule.query.params].filter(([name]) => rule.query.mode !== "ignore-listed" || !rule.query.ignored.includes(name)).map(([name, value]) => `${name}=${value}`).sort();
  const ignored = rule.query.mode === "ignore-listed" ? [...rule.query.ignored].sort() : [];
  const body = rule.body.mode === "ignore" ? null : rule.body.mode === "exact" ? ["exact", rule.body.text] : ["json", canonicalJson(rule.body.value)];
  // A named part matches any segment whatever its name, so `/:id` and `/:accountId` match the same calls.
  const path = patternText({ segments: rule.path.segments.map((segment) => ("param" in segment ? { param: "_" } : segment)), rest: rule.path.rest });
  return JSON.stringify([rule.method, hosts.mode === "mapped" ? rule.origin : null, path, rule.query.mode, query, ignored, body]);
}

/** A JSON value written with its object members sorted, so equal values write equally. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The IDs of +rules+, in precedence order, that an earlier rule with the same request side always answers first. */
export function neverReached(rules: readonly Pick<CompiledRule, "id" | "method" | "origin" | "path" | "query" | "body">[], hosts: HostMatching): Set<string> {
  const seen = new Set<string>();
  const shadowed = new Set<string>();
  for (const rule of rules) {
    const key = requestKey(rule, hosts);
    if (seen.has(key)) shadowed.add(rule.id);
    else seen.add(key);
  }
  return shadowed;
}
