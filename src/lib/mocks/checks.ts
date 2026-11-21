import { IssueCollector } from "@/lib/db/errors";
import { MOCK_BODY_MODES, MOCK_QUERY_MODES, type MockHostMode, type MockUnmatched, type mockRules } from "@/lib/db/schema";
import { formatNumber } from "@/components/ui/count";
import { MATCH_BODY_LIMIT, SELF_ORIGIN } from "./compiled";
import { parsePattern, patternText } from "./engine";
import { COMPUTED_HEADERS, DESCRIPTION_LIMIT, type HostMapping, HOSTS_LIMIT, LATENCY_LIMIT_MS, MB, NAME_LIMIT, REFUSED_HEADERS, RESPONSE_BODY_LIMIT, RESPONSE_LIMIT, type ResponseInput, type RuleInput, type SetInput, type StoredBody, type StoredResponse } from "./model";
import { digestOf } from "./storage";

/*
 * Checking a mock set's settings and a rule as a form, an endpoint, or an
 * import gives them (add-mock-sets, design decisions 5 and 9; mock-sets
 * spec): every problem by field, or the values as they're stored, with the
 * new bodies to write by digest.
 */

const HEADER_LIMIT = 50;
const QUERY_LIMIT = 200;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const METHOD = /^[A-Z]{1,20}$/;

/** A name trimmed, with runs of whitespace made one space. */
function normalized(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** A name as sets compare names: normalized and lowercased, so names are unique ignoring case. */
export function setNameKey(name: string): string {
  return normalized(name).toLowerCase();
}

/** +value+ as an origin, `https://host[:port]`, or null when it isn't an http(s) one. */
export function originOf(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** A content type that says its body is JSON. */
export function isJsonType(type: string | null | undefined): boolean {
  return !!type && /^[^;]*[/+]json\b/i.test(type.trim());
}

function checkHosts(mode: MockHostMode, hosts: readonly HostMapping[], issues: IssueCollector): HostMapping[] {
  if (hosts.length > HOSTS_LIMIT) issues.add("hosts", `A mock set can map up to ${HOSTS_LIMIT} hosts`);
  const seen = new Set<string>();
  const checked: HostMapping[] = [];
  hosts.slice(0, HOSTS_LIMIT).forEach((host, index) => {
    const from = originOf(host.from);
    const to = host.to.trim() === SELF_ORIGIN ? SELF_ORIGIN : originOf(host.to);
    if (!from) issues.add(`hosts.${index}.from`, "Enter an origin, such as https://dev-api.example.test");
    else if (seen.has(from)) issues.add(`hosts.${index}.from`, "Map each recorded origin once");
    if (!to) issues.add(`hosts.${index}.to`, "Enter the origin the build calls, such as https://api.example.test, or choose this preview's own origin");
    if (from && to) {
      seen.add(from);
      checked.push({ from, to });
    }
  });
  if (mode === "mapped" && checked.length === 0 && hosts.length === 0) return [];
  return checked;
}

/** +input+ checked by the spec's limits, as it's stored, or every problem with it. */
export function checkSet(input: SetInput): { name: string; description: string | null; hostMode: MockHostMode; hosts: HostMapping[]; unmatched: MockUnmatched } {
  const issues = new IssueCollector();
  const name = normalized(input.name);
  if (!name) issues.add("name", "Enter a name");
  else if (name.length > NAME_LIMIT) issues.add("name", `Use at most ${NAME_LIMIT} characters`);
  const description = input.description?.trim() || null;
  if (description && description.length > DESCRIPTION_LIMIT) issues.add("description", `Use at most ${DESCRIPTION_LIMIT} characters`);
  const hostMode = input.hostMode ?? "any";
  const hosts = checkHosts(hostMode, input.hosts ?? [], issues);
  issues.throwIfAny();
  return { name, description, hostMode, hosts, unmatched: input.unmatched ?? "pass" };
}

/** The bytes of +text+ as UTF-8. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Whether +bytes+ are a JSON document. */
function validJson(bytes: Uint8Array): string | null {
  try {
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return null;
  } catch (error) {
    return error instanceof SyntaxError ? error.message : "It isn't text";
  }
}

export interface CheckedRule {
  readonly row: Omit<typeof mockRules.$inferInsert, "setId" | "position" | "publicId" | "createdAt" | "updatedAt" | "createdByName" | "updatedByName">;
  /** New bodies to store, by digest. */
  readonly bodies: Map<string, Uint8Array>;
  /** Bodies the rule keeps from before, by digest. */
  readonly kept: Set<string>;
}

function checkResponse(response: ResponseInput, index: number, issues: IssueCollector, bodies: Map<string, Uint8Array>, kept: Set<string>): StoredResponse {
  const field = (part: string) => `responses.${index}.${part}`;
  if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) issues.add(field("status"), "Enter a status from 200 to 599");
  if (!Number.isInteger(response.latencyMs) || response.latencyMs < 0 || response.latencyMs > LATENCY_LIMIT_MS) issues.add(field("latencyMs"), `Enter a latency from 0 to ${formatNumber(LATENCY_LIMIT_MS)} milliseconds`);
  let contentType = response.contentType?.trim() || null;
  const headers: [string, string][] = [];
  if (response.headers.length > HEADER_LIMIT) issues.add(field("headers"), `A response can have up to ${HEADER_LIMIT} headers`);
  for (const [rawName, rawValue] of response.headers.slice(0, HEADER_LIMIT)) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!name && !value) continue;
    const lower = name.toLowerCase();
    if (REFUSED_HEADERS.has(lower)) issues.add(field("headers"), "A mocked response can't set cookies. Remove the Set-Cookie header.");
    else if (!HEADER_NAME.test(name) || name.length > 256) issues.add(field("headers"), `${JSON.stringify(name)} isn't a header name`);
    else if (/[\r\n\0]/.test(value) || value.length > 4096) issues.add(field("headers"), `The value of ${name} can't have line breaks or more than 4,096 characters`);
    else if (lower === "content-type") contentType ??= value;
    else if (!COMPUTED_HEADERS.has(lower)) headers.push([name, value]);
  }
  let body: StoredBody | null = null;
  if (response.body instanceof Uint8Array) {
    if (response.body.byteLength > RESPONSE_BODY_LIMIT) issues.add(field("body"), `A response's body can have up to ${RESPONSE_BODY_LIMIT / MB} MB`);
    else if (isJsonType(contentType) && response.body.byteLength > 0 && validJson(response.body) !== null) issues.add(field("body"), "The body isn't valid JSON. Check its brackets, quotes, and commas.");
    else {
      const digest = digestKey(response.body);
      bodies.set(digest, response.body);
      body = { digest, size: response.body.byteLength, type: contentType };
    }
  } else if (response.body) {
    kept.add(response.body.keep);
    body = { digest: response.body.keep, size: response.body.size, type: contentType };
  }
  return { status: response.status, headers, body, latencyMs: response.latencyMs };
}

/** A body's digest, computed once per input. */
const digests = new WeakMap<Uint8Array, string>();
function digestKey(bytes: Uint8Array): string {
  let digest = digests.get(bytes);
  if (!digest) {
    digest = digestOf(bytes);
    digests.set(bytes, digest);
  }
  return digest;
}

/** +input+ checked as a rule, as it's stored, with the bodies to write, or every problem with it. */
export function checkRule(input: RuleInput): CheckedRule {
  const issues = new IssueCollector();
  const method = input.method.trim().toUpperCase();
  const storedMethod = method === "*" || method === "ANY" ? "*" : method;
  if (storedMethod !== "*" && !METHOD.test(storedMethod)) issues.add("method", "Choose a method, or any method");
  const pattern = input.pattern.trim();
  const parsed = parsePattern(pattern);
  if (!parsed) issues.add("pattern", "Enter a path starting with /, such as /v1/accounts/:id. Name each part that changes with :name, and end with * to match the rest of the path.");
  else if (pattern.length > 2048) issues.add("pattern", "Use at most 2,048 characters");
  const origin = input.origin ? originOf(input.origin) : null;
  if (input.origin && !origin) issues.add("origin", "Enter an origin, such as https://api.example.test");
  if (!(MOCK_QUERY_MODES as readonly string[]).includes(input.queryMode)) issues.add("queryMode", "Choose how the query is matched");
  if (!(MOCK_BODY_MODES as readonly string[]).includes(input.bodyMode)) issues.add("bodyMode", "Choose how the body is matched");
  if (input.query.length > QUERY_LIMIT || input.queryIgnored.length > QUERY_LIMIT) issues.add("query", `A rule can match up to ${QUERY_LIMIT} query parameters`);
  const query = input.query.slice(0, QUERY_LIMIT).map(([name, value]): [string, string] => [name, value]).filter(([name]) => name !== "");
  const queryIgnored = [...new Set(input.queryIgnored.map((name) => name.trim()).filter(Boolean))].slice(0, QUERY_LIMIT);

  const bodies = new Map<string, Uint8Array>();
  const kept = new Set<string>();
  let body: StoredBody | null = null;
  if (input.bodyMode !== "ignore") {
    const given = input.body;
    if (!given) issues.add("body", "Enter the body to compare, or ignore the body");
    else if ("bytes" in given) {
      if (given.bytes.byteLength > MATCH_BODY_LIMIT) issues.add("body", `A body to compare can have up to ${MATCH_BODY_LIMIT / 1024} KB`);
      else if (input.bodyMode === "json" && validJson(given.bytes) !== null) issues.add("body", "The body to compare isn't valid JSON. Compare it exactly, or fix it.");
      else {
        const digest = digestKey(given.bytes);
        bodies.set(digest, given.bytes);
        body = { digest, size: given.bytes.byteLength, type: given.type };
      }
    } else {
      kept.add(given.keep);
      body = { digest: given.keep, size: given.size, type: given.type };
    }
  }

  if (input.responses.length > RESPONSE_LIMIT) issues.add("responses", `A rule can have up to ${RESPONSE_LIMIT} responses`);
  const responses = input.responses.slice(0, RESPONSE_LIMIT).map((response, index) => checkResponse(response, index, issues, bodies, kept));
  issues.throwIfAny();
  return {
    row: {
      enabled: responses.length > 0 && input.enabled !== false,
      method: storedMethod,
      origin,
      pattern: patternText(parsed!),
      queryMode: input.queryMode,
      query,
      queryIgnored,
      bodyMode: input.bodyMode,
      bodyDigest: body?.digest ?? null,
      bodySize: body?.size ?? null,
      bodyType: body?.type ?? null,
      responses: responses as never,
    },
    bodies,
    kept,
  };
}

/** A call to make a rule from: one that wasn't matched, or that failed. */
export interface CallInput {
  readonly method: string;
  readonly url: string;
  /** Its request body as text, when it had one. */
  readonly body?: string | null;
  readonly bodyType?: string | null;
}

/**
 * A rule matching +call+ as it was made: its method, origin, literal path,
 * exact query, and its body as JSON when it is JSON, exactly otherwise, or
 * ignored past 64 KB. It has no response, so it's off, marked Needs a
 * response: the Frontend Registry never invents or copies one (mock-sets
 * spec, "A rule made from a call has no response until one is written").
 */
export function ruleFromCall(call: CallInput): RuleInput {
  const url = new URL(call.url);
  const path = { segments: url.pathname.split("/").filter(Boolean).map((segment) => ({ literal: safeDecode(segment) })), rest: false };
  const body = call.body ? utf8(call.body) : null;
  const comparable = body && body.byteLength > 0 && body.byteLength <= MATCH_BODY_LIMIT ? body : null;
  return {
    method: call.method,
    origin: url.origin,
    pattern: patternText(path),
    queryMode: url.search ? "exact" : "ignore_all",
    query: [...url.searchParams.entries()],
    queryIgnored: [],
    bodyMode: comparable ? (validJson(comparable) === null ? "json" : "exact") : "ignore",
    body: comparable ? { bytes: comparable, type: call.bodyType ?? null } : null,
    responses: [],
    enabled: false,
  };
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
