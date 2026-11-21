import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { groupCalls } from "@/lib/mocks/group";
import { readHar } from "@/lib/mocks/har-import";
import { sanitizeCall } from "@/lib/mocks/sanitize";

/*
 * Grouping calls into rules (add-mock-sets, design decisions 5 and 12, step
 * 6, task 3.4; mock-set-import spec, "Identical calls become one rule with
 * their responses in order" and "The review lists the hosts recorded").
 */

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "har", name), "utf8");
const rulesOf = (source: string) => groupCalls(readHar(source).calls.map(sanitizeCall));
const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : null);

let clock = 0;
/** A recorded fetch of +url+ answered with +body+. */
function entry(url: string, body: unknown, options: { method?: string; postData?: string; mimeType?: string } = {}) {
  clock += 1000;
  return {
    startedDateTime: new Date(Date.UTC(2026, 10, 19, 10) + clock).toISOString(),
    _resourceType: "fetch",
    request: { method: options.method ?? "GET", url, headers: [], cookies: [], ...(options.postData !== undefined && { postData: { mimeType: options.mimeType ?? "application/json", text: options.postData } }) },
    response: { status: 200, headers: [], cookies: [], content: { mimeType: "application/json", size: 1, text: JSON.stringify(body) } },
  };
}
const har = (entries: unknown[]) => JSON.stringify({ log: { version: "1.2", entries } });

describe("grouping calls into rules", () => {
  it("A polled export: three calls to GET /v1/exports/9 become one rule with pending, pending, and ready", () => {
    const { rules } = rulesOf(fixture("orders-portal.chrome.har"));
    const exports = rules.find((rule) => rule.pattern === "/v1/exports/9")!;
    expect(exports.responses.map((response) => JSON.parse(text(response.body?.bytes)!).status)).toEqual(["pending", "pending", "ready"]);
    expect([exports.calls, exports.queryMode, exports.bodyMode]).toEqual([3, "exact", "ignore"]);
  });

  it("Two searches: POST /v1/orders/search with two JSON bodies becomes two rules, each matching its body as JSON", () => {
    const { rules } = rulesOf(fixture("orders-portal.chrome.har"));
    const searches = rules.filter((rule) => rule.pattern === "/v1/orders/search");
    expect(searches.map((rule) => [rule.bodyMode, text(rule.body?.bytes)])).toEqual([
      ["json", '{"status":"open"}'],
      ["json", '{"status":"closed"}'],
    ]);
  });

  it("A cache buster: two calls differing only by `_` become one rule that ignores `_`", () => {
    const { rules } = rulesOf(har([entry("https://api.test/v1/orders?limit=5&_=1", { orders: [] }), entry("https://api.test/v1/orders?limit=5&_=2", { orders: [] })]));
    expect(rules.map((rule) => [rule.pattern, rule.queryMode, rule.query, rule.queryIgnored, rule.responses.length])).toEqual([["/v1/orders", "ignore_listed", [["limit", "5"]], ["_"], 2]]);
  });

  it("ignores a timestamp added to each poll, though the answers change", () => {
    const { rules } = rulesOf(har([entry("https://api.test/v1/exports/9?_=1763650000000", { status: "pending" }), entry("https://api.test/v1/exports/9?_=1763650000500", { status: "ready" })]));
    expect(rules.map((rule) => [rule.queryMode, rule.queryIgnored, rule.responses.length])).toEqual([["ignore_listed", ["_"], 2]]);
  });

  it("keeps a parameter exact when its values change with the rest of the query", () => {
    const { rules } = rulesOf(har([entry("https://api.test/v1/orders?page=1", { page: 1 }), entry("https://api.test/v1/orders?page=2", { page: 2 })]));
    expect(rules.map((rule) => [rule.queryMode, rule.query])).toEqual([
      ["exact", [["page", "1"]]],
      ["exact", [["page", "2"]]],
    ]);
  });

  it("ignores a body with a redacted value, and compares bodies that aren't JSON exactly", () => {
    const { rules } = rulesOf(
      har([
        entry("https://api.test/v1/session", { ok: 1 }, { method: "POST", postData: '{"user":"a","password":"one"}' }),
        entry("https://api.test/v1/session", { ok: 2 }, { method: "POST", postData: '{"user":"b","password":"two"}' }),
        entry("https://api.test/v1/notes", { id: 1 }, { method: "POST", postData: "first", mimeType: "text/plain" }),
        entry("https://api.test/v1/notes", { id: 2 }, { method: "POST", postData: "second", mimeType: "text/plain" }),
      ]),
    );
    expect(rules.map((rule) => [rule.pattern, rule.bodyMode, rule.responses.length])).toEqual([
      ["/v1/session", "ignore", 2],
      ["/v1/notes", "exact", 1],
      ["/v1/notes", "exact", 1],
    ]);
  });

  it("keeps the first 19 responses and the last of a group past 20, and says how many it left out", () => {
    const { rules } = rulesOf(har(Array.from({ length: 23 }, (_, index) => entry("https://api.test/v1/poll", { n: index }))));
    expect(rules[0]!.responses.map((response) => JSON.parse(text(response.body?.bytes)!).n)).toEqual([...Array.from({ length: 19 }, (_, index) => index), 22]);
    expect(rules[0]!.dropped).toBe(3);
  });

  it("orders rules by their first call, and keeps literal paths", () => {
    const { rules } = rulesOf(fixture("orders-portal.chrome.har"));
    expect(rules.map((rule) => `${rule.method} ${rule.pattern}`)).toEqual([
      "POST /v1/session",
      "GET /v1/orders",
      "GET /v1/orders/stream",
      "GET /v1/accounts/42",
      "POST /v1/orders/search",
      "POST /v1/orders/search",
      "POST /v1/exports",
      "GET /v1/exports/9",
      "GET /v1/exports/9/file",
      "GET /v1/regions",
      "GET /v1/settings",
    ]);
    expect(rules.find((rule) => rule.pattern === "/v1/exports/9/file")?.binary).toBe(true);
  });
});

describe("the hosts recorded", () => {
  it("One host: lists the origin, and the set matches any host", () => {
    expect(rulesOf(fixture("orders-portal.chrome.har")).hosts).toEqual({ origins: [{ origin: "https://dev-api.orders.test", calls: 14 }], mode: "any", conflicts: [] });
  });

  it("Two hosts with the same path: GET /v1/config recorded on two origins with different responses needs mapped hosts", () => {
    expect(rulesOf(fixture("orders-portal.two-hosts.har")).hosts).toEqual({
      origins: [
        { origin: "https://dev-api.orders.test", calls: 2 },
        { origin: "https://dev-auth.orders.test", calls: 1 },
      ],
      mode: "mapped",
      conflicts: ["GET /v1/config"],
    });
  });

  it("keeps any host when two origins answer one path the same", () => {
    const { hosts } = rulesOf(har([entry("https://a.test/v1/health", { ok: true }), entry("https://b.test/v1/health", { ok: true })]));
    expect([hosts.mode, hosts.origins.length]).toEqual(["any", 2]);
  });
});
