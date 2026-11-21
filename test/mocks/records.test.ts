import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { chooseSet, resolveActiveSet } from "@/lib/mocks/active";
import { applicationDefault, setApplicationDefault } from "@/lib/mocks/defaults";
import { type RuleInput, RESPONSE_BODY_LIMIT, RULE_LIMIT, SET_BODY_LIMIT, SET_LIMIT } from "@/lib/mocks/model";
import { checkRule } from "@/lib/mocks/checks";
import { StaleMockRuleError, StaleMockSetError, addRulesFromCalls, allRules, appendRules, createRule, createSet, deleteRule, deleteSet, duplicateRule, editRule, editSet, findSet, listSets, moveRule, setRuleEnabled, storedBodyBytes } from "@/lib/mocks/records";
import { setDirectory, sweepMockStorage } from "@/lib/mocks/storage";
import { deleteApplication } from "@/lib/applications/records";
import { deleteRepository } from "@/lib/repositories/registration";
import { immediate } from "@/lib/db/client";
import type { ViewedApplication } from "@/lib/workspaces/access";
import { ensureWorkspace } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { viewedApplicationIn } from "../support/views";

/*
 * Mock set records (add-mock-sets, design decisions 9 and 10, task 2.4):
 * sets and rules with lock versions, who changed what, their revision,
 * counts, and sizes kept in each change, the same-application rule, every
 * limit of "Mock sets are bounded", and deletion as "Mock sets are kept
 * until deleted" describes it.
 */

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** A rule for +pattern+ answering +bodies+ as JSON, in order. */
function rule(pattern: string, bodies: unknown[] = [{ ok: true }], extra: Partial<RuleInput> = {}): RuleInput {
  return {
    method: "GET",
    pattern,
    queryMode: "ignore_all",
    query: [],
    queryIgnored: [],
    bodyMode: "ignore",
    responses: bodies.map((body) => ({ status: 200, headers: [], contentType: "application/json", body: json(body), latencyMs: 0 })),
    ...extra,
  };
}

describe("mock set records", () => {
  let db: Db;
  let config: FrontendRegistryConfig;
  let storage: string;
  let orders: ViewedApplication;
  let quotes: ViewedApplication;

  beforeEach(() => {
    db = createTestDb();
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "mock-sets-"));
    config = withOverrides(getConfig(), { previews: { storage } });
    orders = viewedApplicationIn(db, "Orders portal");
    quotes = viewedApplicationIn(db, "Quotes desk");
  });
  afterEach(() => {
    db.$client.close();
    fs.rmSync(storage, { recursive: true, force: true });
  });

  const files = (setPublicId: string) => (fs.existsSync(setDirectory(config, setPublicId)) ? fs.readdirSync(setDirectory(config, setPublicId)).sort() : []);

  describe("sets", () => {
    it("are the application's, listed by name, recording who made and last changed them", () => {
      createSet(db, orders.id, { name: "Happy path" }, "Presenter");
      const errors = createSet(db, orders.id, { name: "Errors", description: "Every call failing" }, null);
      expect(listSets(db, orders.id).map((set) => [set.name, set.createdByName, set.isDefault])).toEqual([
        ["Errors", null, false],
        ["Happy path", "Presenter", false],
      ]);
      expect(listSets(db, quotes.id)).toEqual([]);
      const edited = editSet(db, orders.id, errors.publicId, errors.lockVersion, { name: "Errors", description: "Failing calls", unmatched: "not_mocked" }, "Visitor");
      expect([edited.updatedByName, edited.createdByName, edited.unmatched, edited.revision, edited.lockVersion]).toEqual(["Visitor", null, "not_mocked", 2, 1]);
    });

    it("Duplicate name: refuses a name the application has, ignoring case, but not another application's", () => {
      createSet(db, orders.id, { name: "Happy path" }, null);
      expect(() => createSet(db, orders.id, { name: "  happy   PATH " }, null)).toThrow(/Another mock set of this application has that name/);
      createSet(db, quotes.id, { name: "Happy path" }, null);
    });

    it("refuses a stale edit, carrying the set as it stands", () => {
      const set = createSet(db, orders.id, { name: "Happy path" }, null);
      editSet(db, orders.id, set.publicId, set.lockVersion, { name: "Happy path", description: "First" }, "First");
      const stale = (() => {
        try {
          editSet(db, orders.id, set.publicId, set.lockVersion, { name: "Happy path", description: "Second" }, "Second");
        } catch (error) {
          return error;
        }
      })() as StaleMockSetError;
      expect(stale).toBeInstanceOf(StaleMockSetError);
      expect(stale.current.description).toBe("First");
    });

    it("checks names, descriptions, and mapped hosts", () => {
      expect(() => createSet(db, orders.id, { name: " " }, null)).toThrow(/name: Enter a name/);
      expect(() => createSet(db, orders.id, { name: "x".repeat(61) }, null)).toThrow(/at most 60/);
      expect(() => createSet(db, orders.id, { name: "Long", description: "x".repeat(281) }, null)).toThrow(/at most 280/);
      expect(() => createSet(db, orders.id, { name: "Hosts", hostMode: "mapped", hosts: [{ from: "dev-api", to: "self" }] }, null)).toThrow(/hosts.0.from/);
      const mapped = createSet(db, orders.id, { name: "Mapped", hostMode: "mapped", hosts: [{ from: "https://DEV-API.orders.test:443/", to: "self" }] }, null);
      expect(mapped.hosts).toEqual([{ from: "https://dev-api.orders.test", to: "self" }]);
    });
  });

  describe("rules", () => {
    it("adds rules at the end, keeping the set's revision, rule count, and body size in the same change", () => {
      const set = createSet(db, orders.id, { name: "Happy path" }, null);
      const first = createRule(db, orders.id, set.publicId, rule("/v1/orders", [{ orders: [] }]), "Presenter", config);
      const second = createRule(db, orders.id, set.publicId, rule("/v1/accounts/:id", [{ orders: [] }, { id: "42" }]), "Visitor", config);
      expect([first.rule.position, second.rule.position]).toEqual([0, 1]);
      // The identical body is stored once.
      expect(second.set).toMatchObject({ revision: 3, ruleCount: 2, bodyBytes: json({ orders: [] }).byteLength + json({ id: "42" }).byteLength, updatedByName: "Visitor" });
      expect(files(set.publicId)).toHaveLength(2);
      expect(second.rule).toMatchObject({ createdByName: "Visitor", enabled: true, method: "GET", pattern: "/v1/accounts/:id" });
    });

    it("Two people edit one rule: the second save is refused, carrying the first visitor's response", () => {
      const set = createSet(db, orders.id, { name: "Happy path" }, null);
      const { rule: created } = createRule(db, orders.id, set.publicId, rule("/v1/accounts/:id", [{ name: "Original" }]), "Presenter", config);
      editRule(db, orders.id, set.publicId, created.publicId, created.lockVersion, rule("/v1/accounts/:id", [{ name: "First" }]), "First", config);
      let stale: unknown;
      try {
        editRule(db, orders.id, set.publicId, created.publicId, created.lockVersion, rule("/v1/accounts/:id", [{ name: "Second" }]), "Second", config);
      } catch (error) {
        stale = error;
      }
      expect(stale).toBeInstanceOf(StaleMockRuleError);
      expect((stale as StaleMockRuleError).message).toMatch(/Someone else changed this rule/);
      const digest = (stale as StaleMockRuleError).current.responses[0]!.body!.digest;
      expect(fs.readFileSync(path.join(setDirectory(config, set.publicId), digest), "utf8")).toBe('{"name":"First"}');
      // The replaced body is gone.
      expect(files(set.publicId)).toEqual([digest]);
      expect((stale as StaleMockRuleError).current.updatedByName).toBe("First");
    });

    it("moves, duplicates, turns off and on, and deletes rules", () => {
      const set = createSet(db, orders.id, { name: "Happy path" }, null);
      const [a, b, c] = ["/a", "/b", "/c"].map((pattern) => createRule(db, orders.id, set.publicId, rule(pattern), null, config).rule);
      moveRule(db, orders.id, set.publicId, c!.publicId, "up", null);
      expect(allRules(db, set.id).map((item) => item.pattern)).toEqual(["/a", "/c", "/b"]);
      moveRule(db, orders.id, set.publicId, a!.publicId, "up", null);
      expect(allRules(db, set.id).map((item) => item.pattern)).toEqual(["/a", "/c", "/b"]);
      const copy = duplicateRule(db, orders.id, set.publicId, a!.publicId, "Visitor");
      expect(allRules(db, set.id).map((item) => [item.pattern, item.enabled])).toEqual([
        ["/a", true],
        ["/a", false],
        ["/c", true],
        ["/b", true],
      ]);
      expect(copy.set.ruleCount).toBe(4);
      setRuleEnabled(db, orders.id, set.publicId, b!.publicId, false, null);
      expect(allRules(db, set.id).find((item) => item.publicId === b!.publicId)!.enabled).toBe(false);
      const after = deleteRule(db, orders.id, set.publicId, copy.rule.publicId, null, config);
      // Each change moved the revision on, apart from the move at the top, which changed nothing.
      expect([after.ruleCount, after.revision]).toEqual([3, 8]);
      expect(() => deleteRule(db, orders.id, set.publicId, copy.rule.publicId, null, config)).toThrow(NotFoundError);
    });

    it("Created from a failed call: takes its method, path, query, and body, and needs a response before it's turned on", () => {
      const set = createSet(db, orders.id, { name: "Happy path" }, null);
      const { rules } = addRulesFromCalls(db, orders.id, set.publicId, [{ method: "GET", url: "https://api.orders.test/v1/rates?base=USD" }, { method: "POST", url: "https://api.orders.test/v1/orders/search", body: '{"status":"open"}' }], null, config);
      expect(rules.map((item) => [item.method, item.origin, item.pattern, item.queryMode, item.query, item.bodyMode, item.enabled, item.responses.length])).toEqual([
        ["GET", "https://api.orders.test", "/v1/rates", "exact", [["base", "USD"]], "ignore", false, 0],
        ["POST", "https://api.orders.test", "/v1/orders/search", "ignore_all", [], "json", false, 0],
      ]);
      expect(() => setRuleEnabled(db, orders.id, set.publicId, rules[0]!.publicId, true, null)).toThrow(/Write a response for this rule before turning it on/);
      // A rule saved without a response is off too.
      expect(createRule(db, orders.id, set.publicId, { ...rule("/v1/rates", []), enabled: true }, null, config).rule.enabled).toBe(false);
    });

    it("checks responses: a status from 200 to 599, no Set-Cookie, valid JSON, and the computed headers left out", () => {
      const set = createSet(db, orders.id, { name: "Happy path" }, null);
      const response = (extra: object) => ({ ...rule("/v1/orders"), responses: [{ status: 200, headers: [], contentType: "application/json", body: json({}), latencyMs: 0, ...extra }] }) as RuleInput;
      expect(() => checkRule(response({ status: 99 }))).toThrow(/responses.0.status: Enter a status from 200 to 599/);
      expect(() => checkRule(response({ headers: [["Set-Cookie", "session=1"]] }))).toThrow(/A mocked response can't set cookies/);
      expect(() => checkRule(response({ body: new TextEncoder().encode('{"orders": [') }))).toThrow(/responses.0.body: The body isn't valid JSON/);
      expect(() => checkRule(response({ latencyMs: 30_001 }))).toThrow(/responses.0.latencyMs/);
      expect(() => checkRule({ ...rule("v1/orders") })).toThrow(/pattern: Enter a path starting with \//);
      expect(() => checkRule({ ...rule("/v1/orders"), bodyMode: "json", body: { bytes: new TextEncoder().encode("not json"), type: null } })).toThrow(/body: The body to compare isn't valid JSON/);
      const created = createRule(db, orders.id, set.publicId, response({ headers: [["Content-Length", "2"], ["X-Request-Id", "1"], ["content-type", "text/plain"]] }), null, config).rule;
      expect(created.responses[0]).toMatchObject({ headers: [["X-Request-Id", "1"]], body: { type: "application/json" } });
    });
  });

  describe("Mock sets are bounded", () => {
    it("The 11th set: an application can have 10 mock sets, and to delete one first", () => {
      for (let index = 0; index < SET_LIMIT; index++) createSet(db, orders.id, { name: `Set ${index}` }, null);
      expect(() => createSet(db, orders.id, { name: "Another" }, null)).toThrow("An application can have 10 mock sets. Delete one first.");
      createSet(db, quotes.id, { name: "Another" }, null);
    });

    it("a set holds at most 500 rules", () => {
      const set = createSet(db, orders.id, { name: "Happy path" }, null);
      const rules = Array.from({ length: RULE_LIMIT }, (_, index) => checkRule(rule(`/v1/items/${index}`, [{ index: 0 }])));
      immediate(db, (tx) => appendRules(tx, findSet(tx, orders.id, set.publicId)!, rules, null, config));
      expect(() => createRule(db, orders.id, set.publicId, rule("/v1/one-more"), null, config)).toThrow(/A mock set can have 500 rules/);
      expect(findSet(db, orders.id, set.publicId)!.ruleCount).toBe(RULE_LIMIT);
    });

    it("A set's bodies past 20 MB: the rule isn't saved, and nothing of it stays", () => {
      const set = createSet(db, orders.id, { name: "Happy path" }, null);
      const large = (fill: number) => ({ status: 200, headers: [], contentType: "application/octet-stream", body: new Uint8Array(4 * 1024 * 1024).fill(fill), latencyMs: 0 }) as RuleInput["responses"][number];
      createRule(db, orders.id, set.publicId, { ...rule("/v1/files/a"), responses: [large(1), large(2), large(3), large(4)] }, null, config);
      expect(() => createRule(db, orders.id, set.publicId, { ...rule("/v1/files/b"), responses: [large(5), large(6)] }, null, config)).toThrow("A mock set's responses can hold 20 MB in all. Remove large responses, or put them in another mock set.");
      expect(findSet(db, orders.id, set.publicId)!.ruleCount).toBe(1);
      expect(findSet(db, orders.id, set.publicId)!.bodyBytes).toBeLessThanOrEqual(SET_BODY_LIMIT);
      // A body larger than 5 MB is refused on its own.
      expect(() => checkRule({ ...rule("/v1/files/c"), responses: [{ ...large(7), body: new Uint8Array(RESPONSE_BODY_LIMIT + 1) }] })).toThrow(/A response's body can have up to 5 MB/);
    });

    it("The Frontend Registry's limit: every set's bodies together stay under previews.maxMockStorageBytes", () => {
      const small = withOverrides(config, { previews: { maxMockStorageBytes: 100 } });
      const first = createSet(db, orders.id, { name: "Happy path" }, null);
      createRule(db, orders.id, first.publicId, rule("/v1/a", ["x".repeat(60)]), null, small);
      const second = createSet(db, quotes.id, { name: "Happy path" }, null);
      expect(() => createRule(db, quotes.id, second.publicId, rule("/v1/b", ["y".repeat(60)]), null, small)).toThrow("Mock set storage is full. Deleting mock sets that are no longer used frees it.");
      expect(storedBodyBytes(db)).toBe(62);
    });
  });

  describe("the same application", () => {
    it("finds no set of another application, for rules, defaults, and choices", () => {
      const own = createSet(db, quotes.id, { name: "Quotes" }, null);
      expect(findSet(db, orders.id, own.publicId)).toBeUndefined();
      expect(() => createRule(db, orders.id, own.publicId, rule("/v1/orders"), null, config)).toThrow(NotFoundError);
      expect(() => setApplicationDefault(db, orders.id, own.publicId)).toThrow(NotFoundError);
      expect(() => chooseSet(db, ensureWorkspace(db, "k".repeat(43)).id, orders.id, null, own.publicId)).toThrow(NotFoundError);
      expect(() => editSet(db, orders.id, own.publicId, 0, { name: "Mine" }, null)).toThrow(NotFoundError);
    });
  });

  describe("Mock sets are kept until deleted", () => {
    it("deleting a set removes its rules and files, and every default and choice naming it", () => {
      const happy = createSet(db, orders.id, { name: "Happy path" }, null);
      createRule(db, orders.id, happy.publicId, rule("/v1/orders"), null, config);
      setApplicationDefault(db, orders.id, happy.publicId);
      const workspace = ensureWorkspace(db, "v".repeat(43)).id;
      chooseSet(db, workspace, orders.id, null, happy.publicId);
      expect(fs.existsSync(setDirectory(config, happy.publicId))).toBe(true);
      expect(deleteSet(db, orders.id, happy.publicId, config)?.name).toBe("Happy path");
      expect(fs.existsSync(setDirectory(config, happy.publicId))).toBe(false);
      expect(applicationDefault(db, orders.id)).toBeNull();
      expect(resolveActiveSet(db, { applicationId: orders.id, previewId: null, workspaceId: workspace })).toEqual({ set: null, source: "none" });
      expect(db.$client.prepare("select count(*) as n from mock_rules").get()).toEqual({ n: 0 });
      expect(deleteSet(db, orders.id, happy.publicId, config)).toBeUndefined();
    });

    it("Deleting a set others chose: their next load uses the default set", () => {
      const happy = createSet(db, orders.id, { name: "Happy path" }, null);
      const errors = createSet(db, orders.id, { name: "Errors" }, null);
      setApplicationDefault(db, orders.id, happy.publicId);
      const visitor = ensureWorkspace(db, "w".repeat(43)).id;
      chooseSet(db, visitor, orders.id, null, errors.publicId);
      expect(resolveActiveSet(db, { applicationId: orders.id, previewId: null, workspaceId: visitor }).set?.name).toBe("Errors");
      deleteSet(db, orders.id, errors.publicId, config);
      expect(resolveActiveSet(db, { applicationId: orders.id, previewId: null, workspaceId: visitor })).toMatchObject({ set: { name: "Happy path" }, source: "application" });
    });

    it("Deleting the application deletes both its sets and their rules, and the sweep removes their files", async () => {
      const sets = ["Happy path", "Errors"].map((name) => createSet(db, orders.id, { name }, null));
      for (const set of sets) createRule(db, orders.id, set.publicId, rule("/v1/orders", [{ set: set.name }]), null, config);
      const kept = createSet(db, quotes.id, { name: "Quotes" }, null);
      createRule(db, quotes.id, kept.publicId, rule("/v1/desk"), null, config);
      expect(deleteApplication(db, orders.publicId)).toBe(true);
      expect(db.$client.prepare("select count(*) as n from mock_sets").get()).toEqual({ n: 1 });
      expect(db.$client.prepare("select count(*) as n from mock_rules").get()).toEqual({ n: 1 });
      expect(await sweepMockStorage(db, config)).toBe(2);
      for (const set of sets) expect(fs.existsSync(setDirectory(config, set.publicId))).toBe(false);
      expect(files(kept.publicId)).toHaveLength(1);
    });

    it("Deleting its Repository deletes the application's sets too, and the sweep removes their files", async () => {
      const set = createSet(db, orders.id, { name: "Happy path" }, null);
      createRule(db, orders.id, set.publicId, rule("/v1/orders"), null, config);
      const repository = db.$client.prepare("select r.public_id as publicId, r.name from repository_sources r join applications a on a.repository_source_id = r.id where a.id = ?").get(orders.id) as { publicId: string; name: string };
      deleteRepository(db, repository.publicId, repository.name);
      expect(db.$client.prepare("select count(*) as n from mock_sets where application_id = ?").get(orders.id)).toEqual({ n: 0 });
      await sweepMockStorage(db, config);
      expect(fs.existsSync(setDirectory(config, set.publicId))).toBe(false);
    });
  });

  it("refuses a body the set doesn't hold, which only a crafted form could name", () => {
    const set = createSet(db, orders.id, { name: "Happy path" }, null);
    const crafted = { ...rule("/v1/orders"), responses: [{ status: 200, headers: [], contentType: "application/json", body: { keep: "a".repeat(64), size: 2 }, latencyMs: 0 }] } as RuleInput;
    expect(() => createRule(db, orders.id, set.publicId, crafted, null, config)).toThrow(ValidationError);
  });
});
