import { describe, expect, it } from "vitest";
import type { CompiledBodyMatch, CompiledQuery, CompiledResponse, CompiledRule, CompiledSet, HostMatching } from "@/lib/mocks/compiled";
import { BODILESS_STATUSES, type MatchContext, type MockCall, type Sequences, answerHeaders, inPrecedenceOrder, inlineBytes, latencyFor, match, neverReached, notMocked, parsePattern, patternText, specificity } from "@/lib/mocks/engine";

/*
 * The matching engine (add-mock-sets, design decisions 4 to 8, tasks 1.4 and
 * 1.5): one case for each scenario of the mock-sets spec's matching
 * requirements, and for precedence, sequences, and answering as not mocked.
 */

const ORIGIN = "http://127.0.0.1:3100";
const CONTEXT: MatchContext = { origin: ORIGIN, base: "/previews/p1/" };
const API = "https://api.orders.test";

const json = (value: unknown, status = 200): CompiledResponse => ({ status, headers: [], contentType: "application/json", latencyMs: 0, body: { inline: JSON.stringify(value), base64: false } });

let ids = 0;
/** A rule from a pattern such as `GET /v1/accounts/:id`, answering +responses+. */
function rule(label: string, options: { origin?: string | null; query?: Partial<CompiledQuery>; body?: CompiledBodyMatch; responses?: CompiledResponse[]; id?: string } = {}): CompiledRule {
  const [method = "", pattern = ""] = label.split(" ");
  const path = parsePattern(pattern);
  if (!path) throw new Error(`Not a pattern: ${pattern}`);
  return {
    id: options.id ?? `mkr_${String(++ids).padStart(16, "0")}`,
    label,
    method: method === "*" ? null : method,
    origin: options.origin ?? null,
    path,
    query: { mode: "ignore-all", params: [], ignored: [], ...options.query },
    body: options.body ?? { mode: "ignore" },
    responses: options.responses ?? [json({ rule: label })],
  };
}

/** A set of +rules+, compiled into precedence order as `compile` does. */
function set(rules: CompiledRule[], options: { hosts?: HostMatching; unmatched?: CompiledSet["unmatched"] } = {}): CompiledSet {
  const hosts = options.hosts ?? { mode: "any" };
  return { set: "mks_0000000000000001", name: "Happy path", revision: 1, hosts, unmatched: options.unmatched ?? "pass", rules: inPrecedenceOrder(rules, hosts) };
}

const call = (method: string, url: string, body?: string): MockCall => ({ method, url, body });

/** The label of the rule that answers +request+, or the result's kind. */
function answer(mocks: CompiledSet, request: MockCall, sequences: Sequences = new Map(), context = CONTEXT): string {
  const result = match(mocks, request, context, sequences);
  return result.kind === "rule" ? result.rule.label : result.kind;
}

describe("a rule matches a call by method, address, query, and body", () => {
  it("Matching a call: GET /v1/accounts/:id answers GET https://api.orders.test/v1/accounts/42", () => {
    const mocks = set([rule("GET /v1/accounts/:id")]);
    expect(answer(mocks, call("GET", `${API}/v1/accounts/42`))).toBe("GET /v1/accounts/:id");
    // Another method doesn't match; any method does.
    expect(answer(mocks, call("POST", `${API}/v1/accounts/42`))).toBe("unmatched");
    expect(answer(set([rule("* /v1/accounts/:id")]), call("DELETE", `${API}/v1/accounts/42`))).toBe("* /v1/accounts/:id");
    // Methods compare in uppercase.
    expect(answer(mocks, call("get", `${API}/v1/accounts/42`))).toBe("GET /v1/accounts/:id");
  });

  it("A rule turned off: a set compiled without it, or a rule with no response, answers nothing", () => {
    expect(answer(set([]), call("GET", `${API}/v1/accounts/42`))).toBe("unmatched");
    expect(answer(set([rule("GET /v1/accounts/:id", { responses: [] })]), call("GET", `${API}/v1/accounts/42`))).toBe("unmatched");
  });
});

describe("address patterns name the parts that change", () => {
  it("A named part: /v1/accounts/:id matches /v1/accounts/42 and /v1/accounts/57/, and not /v1/accounts/42/orders", () => {
    const mocks = set([rule("GET /v1/accounts/:id")]);
    expect(answer(mocks, call("GET", `${API}/v1/accounts/42`))).toBe("GET /v1/accounts/:id");
    expect(answer(mocks, call("GET", `${API}/v1/accounts/57/`))).toBe("GET /v1/accounts/:id");
    expect(answer(mocks, call("GET", `${API}/v1/accounts/42/orders`))).toBe("unmatched");
    expect(answer(mocks, call("GET", `${API}/v1/accounts`))).toBe("unmatched");
  });

  it("The rest of the path: /v1/files/* matches /v1/files/reports/2026/q3.csv, but not /v1/files itself", () => {
    const mocks = set([rule("GET /v1/files/*")]);
    expect(answer(mocks, call("GET", `${API}/v1/files/reports/2026/q3.csv`))).toBe("GET /v1/files/*");
    expect(answer(mocks, call("GET", `${API}/v1/files`))).toBe("unmatched");
  });

  it("compares segments after percent-decoding, with a trailing slash on either side", () => {
    const mocks = set([rule("GET /v1/files/q3%20report.csv"), rule("GET /v1/regions/")]);
    expect(answer(mocks, call("GET", `${API}/v1/files/q3%20report.csv`))).toBe("GET /v1/files/q3%20report.csv");
    expect(answer(mocks, call("GET", `${API}/v1/files/q3 report.csv`))).toBe("GET /v1/files/q3%20report.csv");
    expect(answer(mocks, call("GET", `${API}/v1/regions`))).toBe("GET /v1/regions/");
    // Invalid percent-encoding is compared as it is.
    expect(answer(set([rule("GET /v1/odd/:name")]), call("GET", `${API}/v1/odd/100%`))).toBe("GET /v1/odd/:name");
  });

  it("A relative call: under the build's path, the part after it is matched", () => {
    const mocks = set([rule("GET /api/accounts")]);
    // `api/accounts` from a build served at /previews/p1/, once the build had no such file.
    expect(answer(mocks, call("GET", `${ORIGIN}/previews/p1/api/accounts`))).toBe("GET /api/accounts");
    // A root-relative call is matched as it is.
    expect(answer(mocks, call("GET", `${ORIGIN}/api/accounts`))).toBe("GET /api/accounts");
  });

  it("never matches the Frontend Registry's own paths: its toolbar, its pages' files, and other builds' files", () => {
    const mocks = set([rule("* /toolbar/*"), rule("* /_next/*"), rule("* /previews/*")]);
    expect(answer(mocks, call("GET", `${ORIGIN}/toolbar/routing-worker.js`))).toBe("skip");
    expect(answer(mocks, call("GET", `${ORIGIN}/_next/static/chunks/main.js`))).toBe("skip");
    expect(answer(mocks, call("GET", `${ORIGIN}/previews/p2/remoteEntry.js`))).toBe("skip");
    // On another origin they're ordinary paths.
    expect(answer(mocks, call("GET", `${API}/toolbar/x`))).toBe("* /toolbar/*");
  });

  it("parses patterns, refusing what isn't one", () => {
    expect(parsePattern("/v1/accounts/:id")).toEqual({ segments: [{ literal: "v1" }, { literal: "accounts" }, { param: "id" }], rest: false });
    expect(parsePattern("/v1/files/*")).toEqual({ segments: [{ literal: "v1" }, { literal: "files" }], rest: true });
    expect(parsePattern("/")).toEqual({ segments: [], rest: false });
    for (const invalid of ["v1/accounts", "/v1/*/orders", "/v1/:", "/v1/:1d", "/v1/orders?limit=5", "/v1/a b", "/v1/#top"]) expect(parsePattern(invalid), invalid).toBeNull();
    expect(patternText(parsePattern("/v1/files/q3%20report.csv/:name/*")!)).toBe("/v1/files/q3%20report.csv/:name/*");
  });
});

describe("a set matches any host or maps the hosts it recorded", () => {
  const recorded = "https://dev-api.orders.test";

  it("Recorded on a dev host: with any host, GET /v1/orders answers a call to https://api.orders.test", () => {
    expect(answer(set([rule("GET /v1/orders", { origin: recorded })]), call("GET", `${API}/v1/orders`))).toBe("GET /v1/orders");
  });

  it("Mapping two hosts: a call to the auth host gets the response recorded on dev-auth", () => {
    const hosts: HostMatching = {
      mode: "mapped",
      map: [
        { from: "https://dev-api.orders.test", to: "https://api.orders.test" },
        { from: "https://dev-auth.orders.test", to: "https://auth.orders.test" },
      ],
    };
    const mocks = set([rule("GET /v1/config", { origin: "https://dev-api.orders.test", id: "api" }), rule("GET /v1/config", { origin: "https://dev-auth.orders.test", id: "auth" })], { hosts });
    const id = (url: string) => {
      const result = match(mocks, call("GET", url), CONTEXT, new Map());
      return result.kind === "rule" ? result.rule.id : result.kind;
    };
    expect(id("https://auth.orders.test/v1/config")).toBe("auth");
    expect(id("https://api.orders.test/v1/config")).toBe("api");
    // A host no mapping names reaches no recorded rule.
    expect(id("https://other.orders.test/v1/config")).toBe("unmatched");
  });

  it("maps a recorded origin to the Frontend Registry's own for relative calls, and matches a rule with no origin on any host", () => {
    const hosts: HostMatching = { mode: "mapped", map: [{ from: "https://dev-portal.orders.test", to: "self" }] };
    const mocks = set([rule("GET /api/accounts", { origin: "https://dev-portal.orders.test" }), rule("GET /v1/written")], { hosts });
    expect(answer(mocks, call("GET", `${ORIGIN}/previews/p1/api/accounts`))).toBe("GET /api/accounts");
    expect(answer(mocks, call("GET", `${API}/api/accounts`))).toBe("unmatched");
    expect(answer(mocks, call("GET", `${API}/v1/written`))).toBe("GET /v1/written");
    expect(answer(mocks, call("GET", `${ORIGIN}/v1/written`))).toBe("GET /v1/written");
  });

  it("compares origins without case or a default port", () => {
    const hosts: HostMatching = { mode: "mapped", map: [{ from: "https://DEV-API.orders.test:443", to: "https://API.orders.test" }] };
    expect(answer(set([rule("GET /v1/orders", { origin: "https://dev-api.orders.test" })], { hosts }), call("GET", "https://api.orders.test:443/v1/orders"))).toBe("GET /v1/orders");
  });
});

describe("query matching is exact, ignores listed parameters, or ignores all", () => {
  it("A cache buster: ignoring `_`, the rule answers /v1/orders?limit=5&_=1763650000000", () => {
    const mocks = set([rule("GET /v1/orders", { query: { mode: "ignore-listed", params: [["limit", "5"]], ignored: ["_"] } })]);
    expect(answer(mocks, call("GET", `${API}/v1/orders?limit=5&_=1763650000000`))).toBe("GET /v1/orders");
    expect(answer(mocks, call("GET", `${API}/v1/orders?limit=5`))).toBe("GET /v1/orders");
    expect(answer(mocks, call("GET", `${API}/v1/orders?limit=5&page=2`))).toBe("unmatched");
  });

  it("A different value: exact about limit, the rule doesn't answer /v1/orders?limit=10", () => {
    const mocks = set([rule("GET /v1/orders", { query: { mode: "exact", params: [["limit", "5"]], ignored: [] } })]);
    expect(answer(mocks, call("GET", `${API}/v1/orders?limit=10`))).toBe("unmatched");
    expect(answer(mocks, call("GET", `${API}/v1/orders`))).toBe("unmatched");
    expect(answer(mocks, call("GET", `${API}/v1/orders?limit=5`))).toBe("GET /v1/orders");
  });

  it("compares names and values as a multiset, in any order, and ignore all matches any query", () => {
    const exact = set([rule("GET /v1/orders", { query: { mode: "exact", params: [["tag", "a"], ["limit", "5"], ["tag", "b"]], ignored: [] } })]);
    expect(answer(exact, call("GET", `${API}/v1/orders?tag=b&limit=5&tag=a`))).toBe("GET /v1/orders");
    expect(answer(exact, call("GET", `${API}/v1/orders?tag=b&limit=5&tag=b`))).toBe("unmatched");
    expect(answer(set([rule("GET /v1/orders")]), call("GET", `${API}/v1/orders?anything=1`))).toBe("GET /v1/orders");
  });
});

describe("body matching ignores the body, compares it exactly, or compares it as JSON", () => {
  it("Two searches: the JSON-equal rule for closed orders answers `{ \"status\": \"closed\" }`", () => {
    const mocks = set([rule("POST /v1/orders/search", { body: { mode: "json", value: { status: "open" } }, id: "open" }), rule("POST /v1/orders/search", { body: { mode: "json", value: { status: "closed" } }, id: "closed" })]);
    const id = (body: string) => {
      const result = match(mocks, call("POST", `${API}/v1/orders/search`, body), CONTEXT, new Map());
      return result.kind === "rule" ? result.rule.id : result.kind;
    };
    expect(id('{ "status": "closed" }')).toBe("closed");
    expect(id('{"status":"open"}')).toBe("open");
    expect(id('{"status":"pending"}')).toBe("unmatched");
    // A body that isn't JSON never matches JSON-equal.
    expect(id("status=closed")).toBe("unmatched");
  });

  it("compares objects in any member order, arrays in order, and numbers by value", () => {
    const mocks = set([rule("POST /v1/query", { body: { mode: "json", value: { filter: { a: 1, b: [1, 2] }, limit: 5 } } })]);
    expect(answer(mocks, call("POST", `${API}/v1/query`, '{"limit":5.0,"filter":{"b":[1,2],"a":1}}'))).toBe("POST /v1/query");
    expect(answer(mocks, call("POST", `${API}/v1/query`, '{"limit":5,"filter":{"b":[2,1],"a":1}}'))).toBe("unmatched");
    expect(answer(mocks, call("POST", `${API}/v1/query`, '{"limit":5,"filter":{"a":1,"b":[1,2],"c":0}}'))).toBe("unmatched");
  });

  it("compares exact text, and never a body past 64 KB", () => {
    const mocks = set([rule("POST /v1/notes", { body: { mode: "exact", text: "note=hello" } })]);
    expect(answer(mocks, call("POST", `${API}/v1/notes`, "note=hello"))).toBe("POST /v1/notes");
    expect(answer(mocks, call("POST", `${API}/v1/notes`, "note=hello "))).toBe("unmatched");
    expect(answer(mocks, call("POST", `${API}/v1/notes`))).toBe("unmatched");
    const large = "x".repeat(64 * 1024 + 1);
    expect(answer(set([rule("POST /v1/notes", { body: { mode: "exact", text: large } })]), call("POST", `${API}/v1/notes`, large))).toBe("unmatched");
    // Ignoring the body answers whatever it holds.
    expect(answer(set([rule("POST /v1/notes")]), call("POST", `${API}/v1/notes`, large))).toBe("POST /v1/notes");
  });
});

describe("the most specific rule answers (design decision 6)", () => {
  it("A literal path wins: GET /v1/accounts/42 answers, though GET /v1/accounts/:id is listed first", () => {
    const mocks = set([rule("GET /v1/accounts/:id"), rule("GET /v1/accounts/42")]);
    expect(answer(mocks, call("GET", `${API}/v1/accounts/42`))).toBe("GET /v1/accounts/42");
    expect(answer(mocks, call("GET", `${API}/v1/accounts/57`))).toBe("GET /v1/accounts/:id");
  });

  it("Equally specific: the rule listed first answers, and the other is never reached", () => {
    const first = rule("GET /v1/accounts/:id", { id: "first" });
    const second = rule("GET /v1/accounts/:accountId", { id: "second" });
    const mocks = set([first, second]);
    const result = match(mocks, call("GET", `${API}/v1/accounts/42`), CONTEXT, new Map());
    expect(result.kind === "rule" && result.rule.id).toBe("first");
    expect(neverReached(mocks.rules, mocks.hosts)).toEqual(new Set(["second"]));
    // Different request sides are both reached.
    expect(neverReached(set([first, rule("GET /v1/accounts/42")]).rules, mocks.hosts)).toEqual(new Set());
  });

  it("compares the six keys in order: method, mapped origin, literal segments, no final *, query, then body", () => {
    const hosts: HostMatching = { mode: "mapped", map: [] };
    const keys = (label: string, options: Parameters<typeof rule>[1] = {}) => specificity(rule(label, options), hosts);
    expect(keys("* /v1/files/*")).toEqual([0, 0, 2, 0, 0, 0]);
    expect(keys("POST /v1/orders/:id", { origin: API, query: { mode: "exact" }, body: { mode: "json", value: {} } })).toEqual([1, 1, 2, 1, 2, 1]);
    // A named method beats more literal segments; more literal segments beat a narrower query.
    const ordered = inPrecedenceOrder([rule("* /v1/orders/open/today"), rule("GET /v1/:a/:b/:c"), rule("GET /v1/orders/open/:day", { query: { mode: "exact" } }), rule("GET /v1/orders/open/today")], hosts);
    expect(ordered.map((item) => item.label)).toEqual(["GET /v1/orders/open/today", "GET /v1/orders/open/:day", "GET /v1/:a/:b/:c", "* /v1/orders/open/today"]);
    // Query from exact to ignore listed to ignore all, then a compared body over an ignored one.
    const queries = inPrecedenceOrder(
      [rule("GET /v1/q", { id: "all" }), rule("GET /v1/q", { query: { mode: "ignore-listed" }, id: "listed" }), rule("GET /v1/q", { query: { mode: "exact" }, id: "exact" }), rule("GET /v1/q", { query: { mode: "exact" }, body: { mode: "exact", text: "" }, id: "body" })],
      hosts,
    );
    expect(queries.map((item) => item.id)).toEqual(["body", "exact", "listed", "all"]);
  });
});

describe("repeated calls get a rule's responses in order (design decision 7)", () => {
  const exports = rule("GET /v1/exports/9", { responses: [json({ status: "pending" }), json({ status: "pending" }), json({ status: "ready" })] });
  const status = (mocks: CompiledSet, sequences: Sequences) => {
    const result = match(mocks, call("GET", `${API}/v1/exports/9`), CONTEXT, sequences);
    if (result.kind !== "rule") throw new Error(result.kind);
    return `${result.index}:${JSON.parse((result.response.body as { inline: string }).inline).status}`;
  };

  it("Polling an export: four calls get pending, pending, ready, and ready", () => {
    const mocks = set([exports]);
    const sequences: Sequences = new Map();
    expect([status(mocks, sequences), status(mocks, sequences), status(mocks, sequences), status(mocks, sequences)]).toEqual(["0:pending", "1:pending", "2:ready", "2:ready"]);
  });

  it("Reloading: a new document starts the order over, and so does a new revision", () => {
    const mocks = set([exports]);
    const first: Sequences = new Map();
    status(mocks, first);
    status(mocks, first);
    status(mocks, first);
    // The caller starts a new count for the new document.
    expect(status(mocks, new Map())).toBe("0:pending");
  });

  it("counts each rule on its own", () => {
    const mocks = set([exports, rule("GET /v1/orders")]);
    const sequences: Sequences = new Map();
    status(mocks, sequences);
    match(mocks, call("GET", `${API}/v1/orders`), CONTEXT, sequences);
    expect(status(mocks, sequences)).toBe("1:pending");
    expect(sequences.get(exports.id)).toBe(2);
  });
});

describe("calls no rule matches (design decision 8)", () => {
  it("Answering as not mocked: status 501, the header, and a JSON body naming the set, method, and address", () => {
    const answer = notMocked({ name: "Happy path" }, call("get", `${API}/v1/rates`));
    expect(answer.status).toBe(501);
    expect(answer.headers).toContainEqual(["X-Frontend-Registry-Mock", "not-matched"]);
    expect(answer.headers).toContainEqual(["Content-Type", "application/json"]);
    expect(JSON.parse(answer.body)).toEqual({ error: "Not mocked", set: "Happy path", method: "GET", url: `${API}/v1/rates` });
  });
});

describe("answering", () => {
  it("adds the content type to a response's own headers, decodes inline bodies, and waits by the latency chosen", () => {
    const response: CompiledResponse = { status: 200, headers: [["Cache-Control", "no-store"]], contentType: "application/json", latencyMs: 12_500, body: { inline: btoa('{"ok":true}'), base64: true } };
    expect(answerHeaders(response)).toEqual([
      ["Cache-Control", "no-store"],
      ["Content-Type", "application/json"],
    ]);
    expect(new TextDecoder().decode(inlineBytes(response.body as { inline: string; base64: boolean }))).toBe('{"ok":true}');
    expect(new TextDecoder().decode(inlineBytes({ inline: "plain", base64: false }))).toBe("plain");
    expect([latencyFor(response, "off"), latencyFor(response, "recorded"), latencyFor(response, "slow"), latencyFor({ latencyMs: 120 }, "recorded")]).toEqual([0, 10_000, 2_000, 120]);
    // A 204 or 304 is answered without a body, whatever the rule stores.
    expect([204, 304, 200].map((status) => BODILESS_STATUSES.has(status))).toEqual([true, true, false]);
  });
});
