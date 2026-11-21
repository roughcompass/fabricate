import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { INLINE_BODY_LIMIT, compileSet, rulesNeverReached } from "@/lib/mocks/compile";
import type { CompiledSet } from "@/lib/mocks/compiled";
import { type MockCall, match } from "@/lib/mocks/engine";
import type { RuleInput, SetInput } from "@/lib/mocks/model";
import { createRule, createSet, findSet, setRuleEnabled } from "@/lib/mocks/records";
import type { ViewedApplication } from "@/lib/workspaces/access";
import { createTestDb } from "../support/db";
import { viewedApplicationIn } from "../support/views";

/*
 * Compiling a set (add-mock-sets, design decisions 4 and 6, task 2.7): its
 * rows become the set the engine matches, its enabled rules with a response
 * in precedence order, with small bodies inline. Each case stores rules as
 * the records do, compiles them, and matches the spec's scenario.
 */

const ORIGIN = "http://127.0.0.1:3100";
const API = "https://api.orders.test";
const CONTEXT = { origin: ORIGIN, base: "/previews/pvw_0000000000000001/" };

type Rule = Partial<RuleInput> & { pattern: string; answer?: unknown };

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("compiling a mock set", () => {
  let db: Db;
  let config: FrontendRegistryConfig;
  let storage: string;
  let orders: ViewedApplication;

  beforeEach(() => {
    db = createTestDb();
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "mock-compile-"));
    config = withOverrides(getConfig(), { previews: { storage } });
    orders = viewedApplicationIn(db, "Orders portal");
  });
  afterEach(() => {
    db.$client.close();
    fs.rmSync(storage, { recursive: true, force: true });
  });

  /** A set holding +rules+, each answering its `answer`, or its own pattern, as JSON, compiled. */
  function compiled(rules: Rule[], settings: Partial<SetInput> = {}): CompiledSet {
    const set = createSet(db, orders.id, { name: `Set ${Math.random()}`, ...settings }, null);
    for (const { answer, ...rule } of rules) {
      createRule(db, orders.id, set.publicId, { method: "GET", queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "ignore", responses: [{ status: 200, headers: [], contentType: "application/json", body: json(answer ?? rule.pattern), latencyMs: 0 }], ...rule }, null, config);
    }
    return compileSet(db, findSet(db, orders.id, set.publicId)!, config);
  }

  /** What answers +call+: the inline body of the rule's response, or the result's kind. */
  function answer(set: CompiledSet, call: MockCall): unknown {
    const result = match(set, call, CONTEXT, new Map());
    if (result.kind !== "rule") return result.kind;
    const body = result.response.body;
    return body && "inline" in body && !body.base64 ? JSON.parse(body.inline) : body;
  }

  it("Matching a call, and a rule turned off", () => {
    const set = compiled([{ pattern: "/v1/accounts/:id" }]);
    expect(answer(set, { method: "GET", url: `${API}/v1/accounts/42` })).toBe("/v1/accounts/:id");
    const stored = findSet(db, orders.id, set.set)!;
    const [rule] = db.$client.prepare("select public_id from mock_rules where set_id = ?").all(stored.id) as { public_id: string }[];
    setRuleEnabled(db, orders.id, set.set, rule!.public_id, false, null);
    const off = compileSet(db, findSet(db, orders.id, set.set)!, config);
    expect([off.rules, off.revision]).toEqual([[], 3]);
    expect(answer(off, { method: "GET", url: `${API}/v1/accounts/42` })).toBe("unmatched");
  });

  it("A named part, the rest of the path, and a relative call under the build's path", () => {
    const set = compiled([{ pattern: "/v1/accounts/:id" }, { pattern: "/v1/files/*" }, { pattern: "/api/accounts" }]);
    expect(answer(set, { method: "GET", url: `${API}/v1/accounts/57/` })).toBe("/v1/accounts/:id");
    expect(answer(set, { method: "GET", url: `${API}/v1/accounts/42/orders` })).toBe("unmatched");
    expect(answer(set, { method: "GET", url: `${API}/v1/files/reports/2026/q3.csv` })).toBe("/v1/files/*");
    expect(answer(set, { method: "GET", url: `${ORIGIN}/previews/pvw_0000000000000001/api/accounts` })).toBe("/api/accounts");
  });

  it("Recorded on a dev host, and Mapping two hosts", () => {
    expect(answer(compiled([{ pattern: "/v1/orders", origin: "https://dev-api.orders.test" }]), { method: "GET", url: `${API}/v1/orders` })).toBe("/v1/orders");
    const mapped = compiled(
      [
        { pattern: "/v1/config", origin: "https://dev-api.orders.test", answer: "dev-api" },
        { pattern: "/v1/config", origin: "https://dev-auth.orders.test", answer: "dev-auth" },
      ],
      {
        hostMode: "mapped",
        hosts: [
          { from: "https://dev-api.orders.test", to: "https://api.orders.test" },
          { from: "https://dev-auth.orders.test", to: "https://auth.orders.test" },
        ],
      },
    );
    expect(answer(mapped, { method: "GET", url: "https://auth.orders.test/v1/config" })).toBe("dev-auth");
    expect(answer(mapped, { method: "GET", url: "https://api.orders.test/v1/config" })).toBe("dev-api");
  });

  it("A cache buster, and A different value", () => {
    const set = compiled([{ pattern: "/v1/orders", queryMode: "ignore_listed", query: [["limit", "5"]], queryIgnored: ["_"] }]);
    expect(answer(set, { method: "GET", url: `${API}/v1/orders?limit=5&_=1763650000000` })).toBe("/v1/orders");
    expect(answer(set, { method: "GET", url: `${API}/v1/orders?limit=10` })).toBe("unmatched");
  });

  it("Two searches: JSON-equal bodies stored as files and compiled to values", () => {
    const search = (status: string): Rule => ({ method: "POST", pattern: "/v1/orders/search", bodyMode: "json", body: { bytes: json({ status }), type: "application/json" }, answer: status });
    const set = compiled([search("open"), search("closed")]);
    expect(set.rules.map((rule) => rule.body)).toEqual([
      { mode: "json", value: { status: "open" } },
      { mode: "json", value: { status: "closed" } },
    ]);
    expect(answer(set, { method: "POST", url: `${API}/v1/orders/search`, body: '{ "status": "closed" }' })).toBe("closed");
  });

  it("A literal path wins, and Equally specific rules mark the later never reached", () => {
    const set = compiled([{ pattern: "/v1/accounts/:id", answer: "any" }, { pattern: "/v1/accounts/42", answer: "42" }, { pattern: "/v1/accounts/:accountId", answer: "second" }]);
    expect(set.rules.map((rule) => rule.label)).toEqual(["GET /v1/accounts/42", "GET /v1/accounts/:id", "GET /v1/accounts/:accountId"]);
    expect(answer(set, { method: "GET", url: `${API}/v1/accounts/42` })).toBe("42");
    expect(answer(set, { method: "GET", url: `${API}/v1/accounts/57` })).toBe("any");
    expect(rulesNeverReached(set)).toEqual(new Set([set.rules[2]!.id]));
  });

  it("Polling an export: the responses in order, then the last again", () => {
    const set = createSet(db, orders.id, { name: "Exports" }, null);
    createRule(
      db,
      orders.id,
      set.publicId,
      { method: "GET", pattern: "/v1/exports/9", queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "ignore", responses: ["pending", "pending", "ready"].map((status) => ({ status: 200, headers: [], contentType: "application/json", body: json({ status }), latencyMs: 120 })) },
      null,
      config,
    );
    const exports = compileSet(db, findSet(db, orders.id, set.publicId)!, config);
    const sequences = new Map<string, number>();
    const statuses = [1, 2, 3, 4].map(() => {
      const result = match(exports, { method: "GET", url: `${API}/v1/exports/9` }, CONTEXT, sequences);
      return result.kind === "rule" && "inline" in result.response.body! ? JSON.parse(result.response.body.inline).status : result.kind;
    });
    expect(statuses).toEqual(["pending", "pending", "ready", "ready"]);
    expect(exports.rules[0]!.responses[0]).toMatchObject({ status: 200, contentType: "application/json", latencyMs: 120, headers: [] });
  });

  it("Answering as not mocked, and calls passing through by default", () => {
    expect(compiled([], { unmatched: "not_mocked" }).unmatched).toBe("not-mocked");
    expect(compiled([]).unmatched).toBe("pass");
  });

  it("inlines bodies of up to 16 KB, text as it is and binary in base64, and names larger ones by digest", () => {
    const set = createSet(db, orders.id, { name: "Bodies" }, null);
    const body = (bytes: Uint8Array, contentType: string) => ({ status: 200, headers: [], contentType, body: bytes, latencyMs: 0 });
    const small = new TextEncoder().encode("x".repeat(INLINE_BODY_LIMIT));
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0x00]);
    const large = new TextEncoder().encode("y".repeat(INLINE_BODY_LIMIT + 1));
    createRule(db, orders.id, set.publicId, { method: "GET", pattern: "/v1/bodies", queryMode: "ignore_all", query: [], queryIgnored: [], bodyMode: "ignore", responses: [body(small, "text/plain"), body(pdf, "application/pdf"), body(large, "text/plain")] }, null, config);
    const [rule] = compileSet(db, findSet(db, orders.id, set.publicId)!, config).rules;
    expect(rule!.responses.map((response) => response.body)).toEqual([
      { inline: "x".repeat(INLINE_BODY_LIMIT), base64: false },
      { inline: Buffer.from(pdf).toString("base64"), base64: true },
      { digest: expect.stringMatching(/^[0-9a-f]{64}$/), size: INLINE_BODY_LIMIT + 1 },
    ]);
  });
});
