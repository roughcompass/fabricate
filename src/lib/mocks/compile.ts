import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import type { MockQueryMode } from "@/lib/db/schema";
import type { CompiledBody, CompiledBodyMatch, CompiledRule, CompiledSet, HostMatching, QueryMode } from "./compiled";
import { inPrecedenceOrder, neverReached, parsePattern } from "./engine";
import { type MockRule, type MockSet, type StoredBody, ruleLabel } from "./model";
import { allRules } from "./records";
import { readBody, setDirectory } from "./storage";

/*
 * Compiling a set (add-mock-sets, design decisions 2, 4, and 6): its rows
 * become the compiled set the engine matches against, with its enabled
 * rules that have a response in precedence order, most specific first, then
 * in the set's order. A response body of up to 16 KB is inlined; a larger
 * one is named by its digest, which the routing worker fetches once from
 * `…/bodies/<digest>` when it's first used. Compiling reads one set's rules,
 * at most 500 rows.
 */

/** The largest response body inlined in a compiled set. */
export const INLINE_BODY_LIMIT = 16 * 1024;

const QUERY_MODES: Record<MockQueryMode, QueryMode> = { exact: "exact", ignore_listed: "ignore-listed", ignore_all: "ignore-all" };

/** The set's hosts as the engine reads them. */
export function hostMatching(set: Pick<MockSet, "hostMode" | "hosts">): HostMatching {
  return set.hostMode === "mapped" ? { mode: "mapped", map: set.hosts.map((host) => ({ from: host.from, to: host.to })) } : { mode: "any" };
}

/** Whether a body of +type+ is text, which is inlined as it is rather than in base64. */
function isText(type: string | null): boolean {
  return !!type && /^(text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript|x-www-form-urlencoded|graphql)\b)/i.test(type.trim());
}

/** +bytes+ as text, or null when they aren't valid UTF-8. */
function utf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A response's body as the compiled set holds it: inline up to 16 KB, by digest past that. */
function compiledBody(directory: string, body: StoredBody | null): CompiledBody {
  if (!body) return null;
  if (body.size > INLINE_BODY_LIMIT) return { digest: body.digest, size: body.size };
  const bytes = readBody(directory, body.digest);
  if (!bytes) return { digest: body.digest, size: body.size };
  const text = isText(body.type) ? utf8Text(bytes) : null;
  return text === null ? { inline: bytes.toString("base64"), base64: true } : { inline: text, base64: false };
}

/** The rule's body matching, or null when its stored body to compare is gone, so the rule can't match. */
function bodyMatch(directory: string, rule: MockRule): CompiledBodyMatch | null {
  if (rule.bodyMode === "ignore" || !rule.body) return { mode: "ignore" };
  const bytes = readBody(directory, rule.body.digest);
  const text = bytes ? utf8Text(bytes) : null;
  if (text === null) return null;
  if (rule.bodyMode === "exact") return { mode: "exact", text };
  try {
    return { mode: "json", value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

/** +rule+ as the engine reads it, or null for one that can't answer anything. */
function compiledRule(directory: string, rule: MockRule): CompiledRule | null {
  const path = parsePattern(rule.pattern);
  const body = bodyMatch(directory, rule);
  if (!path || !body || !rule.enabled || rule.responses.length === 0) return null;
  return {
    id: rule.publicId,
    label: ruleLabel(rule),
    method: rule.method === "*" ? null : rule.method,
    origin: rule.origin,
    path,
    query: { mode: QUERY_MODES[rule.queryMode], params: rule.query, ignored: rule.queryIgnored },
    body,
    responses: rule.responses.map((response) => ({
      status: response.status,
      headers: response.headers,
      contentType: response.body?.type ?? null,
      latencyMs: response.latencyMs,
      body: compiledBody(directory, response.body),
    })),
  };
}

/** +set+ with +rules+, compiled: only enabled rules with a response, in precedence order. */
export function compileRules(set: MockSet, rules: readonly MockRule[], config: FrontendRegistryConfig = getConfig()): CompiledSet {
  const directory = setDirectory(config, set.publicId);
  const hosts = hostMatching(set);
  const compiled = rules.map((rule) => compiledRule(directory, rule)).filter((rule): rule is CompiledRule => rule !== null);
  return { set: set.publicId, name: set.name, revision: set.revision, hosts, unmatched: set.unmatched === "not_mocked" ? "not-mocked" : "pass", rules: inPrecedenceOrder(compiled, hosts) };
}

/** The set as it stands, compiled. */
export function compileSet(db: Executor, set: MockSet, config: FrontendRegistryConfig = getConfig()): CompiledSet {
  return compileRules(set, allRules(db, set.id), config);
}

/**
 * The public IDs of the set's rules that an earlier, equally specific rule with the same request side always answers first.
 * @public The set's page uses this (add-mock-sets, task 5.2).
 */
export function rulesNeverReached(compiled: CompiledSet): Set<string> {
  return neverReached(compiled.rules, compiled.hosts);
}
