import { type FrontendRegistryConfig, getConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { type MockRule, type MockSet, type StoredBody } from "./model";
import { allRules } from "./records";
import { readBody, setDirectory } from "./storage";

/*
 * Exporting a set as HAR 1.2 (add-mock-sets, design decision 13; mock-sets
 * spec, "A mock set exports as HAR 1.2"): one entry for each response of
 * each rule that has one, in the set's order. Each entry's address is the
 * rule's recorded origin, or `https://mock.invalid` for a rule written
 * without one, with its pattern as written and its query; a compared body is
 * its `postData`. `_frontendRegistry` records the rule's pattern, matching,
 * state, and position, so importing the file restores the same rules. Bodies
 * are exported as stored, already sanitized.
 */

/** The origin of an exported rule that was written without one. */
export const EXPORT_ORIGIN = "https://mock.invalid";
const EPOCH = Date.UTC(2026, 0, 1);

function isText(type: string | null): boolean {
  return !!type && /^\s*(text\/|application\/(?:[\w.+-]*\+)?(?:json|xml|javascript|graphql|x-www-form-urlencoded)\b)/i.test(type);
}

/** A stored body as HAR content: text as it is, anything else in base64. */
function content(directory: string, body: StoredBody | null): { size: number; mimeType: string; text?: string; encoding?: string } {
  if (!body) return { size: 0, mimeType: "x-unknown" };
  const bytes = readBody(directory, body.digest) ?? Buffer.alloc(0);
  const mimeType = body.type ?? "application/octet-stream";
  if (isText(body.type)) {
    try {
      return { size: bytes.byteLength, mimeType, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
      // Not UTF-8 after all: base64 below.
    }
  }
  return { size: bytes.byteLength, mimeType, text: bytes.toString("base64"), encoding: "base64" };
}

const harHeaders = (headers: readonly (readonly [string, string])[]) => headers.map(([name, value]) => ({ name, value }));

function entry(directory: string, rule: MockRule, response: MockRule["responses"][number], sequence: number) {
  const query = rule.query.map(([name, value]) => ({ name, value }));
  const search = rule.query.length ? `?${new URLSearchParams(rule.query.map(([name, value]) => [name, value])).toString()}` : "";
  const body = rule.body ? content(directory, rule.body) : null;
  const answer = content(directory, response.body);
  const responseHeaders = response.body?.type ? [{ name: "Content-Type", value: response.body.type }, ...harHeaders(response.headers)] : harHeaders(response.headers);
  return {
    startedDateTime: new Date(EPOCH + sequence * 1000).toISOString(),
    time: response.latencyMs,
    request: {
      method: rule.method === "*" ? "GET" : rule.method,
      url: `${rule.origin ?? EXPORT_ORIGIN}${rule.pattern}${search}`,
      httpVersion: "HTTP/1.1",
      cookies: [],
      // Sec-Fetch-Dest says it's an API call to any importer, as a browser's would.
      headers: [{ name: "Sec-Fetch-Dest", value: "empty" }, ...(body && rule.body?.type ? [{ name: "Content-Type", value: rule.body.type }] : [])],
      queryString: query,
      ...(body && { postData: { mimeType: body.mimeType, text: body.text ?? "", ...(body.encoding && { encoding: body.encoding }) } }),
      headersSize: -1,
      bodySize: body?.size ?? 0,
    },
    response: { status: response.status, statusText: "", httpVersion: "HTTP/1.1", cookies: [], headers: responseHeaders, content: answer, redirectURL: "", headersSize: -1, bodySize: answer.size },
    cache: {},
    timings: { send: 0, wait: response.latencyMs, receive: 0 },
    _frontendRegistry: { rule: rule.publicId, method: rule.method, pattern: rule.pattern, queryMode: rule.queryMode, ignored: rule.queryIgnored, bodyMode: rule.bodyMode, enabled: rule.enabled, position: rule.position },
  };
}

/** The set's rules with a response, as a HAR 1.2 document. */
export function exportHar(db: Executor, set: MockSet, config: FrontendRegistryConfig = getConfig()) {
  const directory = setDirectory(config, set.publicId);
  let sequence = 0;
  const entries = allRules(db, set.id)
    .filter((rule) => rule.responses.length > 0)
    .flatMap((rule) => rule.responses.map((response) => entry(directory, rule, response, sequence++)));
  return { log: { version: "1.2", creator: { name: "Frontend Registry", version: "1" }, pages: [], entries, comment: `Mock set ${set.name}` } };
}

/** The file name an export downloads as: the application's slug and the set's name, as words joined by hyphens. */
export function exportFileName(slug: string, set: Pick<MockSet, "name">): string {
  const name = set.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${name || "mock-set"}.har`;
}
