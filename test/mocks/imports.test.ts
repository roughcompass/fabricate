import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { applicationDefault } from "@/lib/mocks/defaults";
import { DraftExpiredError, cancelDraft, createDraft, draftContents, getDraft, saveDraft, updateDraft } from "@/lib/mocks/imports";
import { HarFormatError } from "@/lib/mocks/har-import";
import { allRules, createSet, findSet } from "@/lib/mocks/records";
import { importDirectory, setDirectory } from "@/lib/mocks/storage";
import type { ViewedApplication } from "@/lib/workspaces/access";
import { ensureWorkspace } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { viewedApplicationIn } from "../support/views";

/*
 * Drafts of HAR uploads (add-mock-sets, design decision 12, steps 8 to 10,
 * task 3.5; mock-set-import spec): only the sanitized calls are kept, for
 * the uploading workspace alone and for 24 hours; saving moves the checked
 * rules into a set in one transaction within the limits; cancelling leaves
 * nothing.
 */

const CHROME = fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "har", "orders-portal.chrome.har"), "utf8");
const SECRETS = ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln", "hunter2", "sk_test_123", "s3ss10n-f4k3-0001", "tok_f4k3_0002", "ak_live_f4k3k3y0001"];

describe("HAR import drafts", () => {
  let db: Db;
  let storage: string;
  let config: FrontendRegistryConfig;
  let orders: ViewedApplication;
  let presenter: number;

  beforeEach(() => {
    db = createTestDb();
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "mock-imports-"));
    config = withOverrides(getConfig(), { previews: { storage } });
    orders = viewedApplicationIn(db, "Orders portal");
    presenter = ensureWorkspace(db, "p".repeat(43)).id;
  });
  afterEach(() => {
    db.$client.close();
    fs.rmSync(storage, { recursive: true, force: true });
  });

  const upload = (options: { target?: string | null; setName?: string | null; source?: string; now?: Date } = {}) =>
    createDraft(db, { applicationId: orders.id, workspaceId: presenter, fileName: "orders-portal.chrome.har", target: options.target ?? null, setName: options.setName === undefined ? "Happy path" : options.setName, fromOnboarding: false }, options.source ?? CHROME, config, options.now);

  /** Every file under +directory+, as text. */
  const filesUnder = (directory: string): string =>
    fs.existsSync(directory)
      ? fs
          .readdirSync(directory, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), "latin1"))
          .join("\n")
      : "";

  it("keeps the sanitized calls as a draft, with the binary body unchecked, and adds no set until it's saved", () => {
    const draft = upload();
    const contents = draftContents(draft, config);
    expect(contents.calls).toHaveLength(11);
    expect(contents.leftOut).toHaveLength(10);
    expect(draft.unchecked).toEqual([contents.calls.find((call) => call.pattern === "/v1/exports/9/file")!.key]);
    expect(contents.removed.headers).toMatchObject({ authorization: 3, cookie: 3, "set-cookie": 1 });
    expect(contents.removed.tokens).toBe(1);
    expect([draft.entryCount, draft.setName, draft.expiresAt.getTime() - draft.createdAt.getTime()]).toEqual([24, "Happy path", 24 * 3_600_000]);
    expect(db.$client.prepare("select count(*) as n from mock_sets").get()).toEqual({ n: 0 });
  });

  it("refuses a file that isn't a HAR, writing nothing", () => {
    expect(() => upload({ source: '{"log":{}}' })).toThrow(HarFormatError);
    expect(fs.existsSync(path.join(storage, ".mock-imports")) ? fs.readdirSync(path.join(storage, ".mock-imports")) : []).toEqual([]);
  });

  it("is readable only by its workspace, and says it expired after 24 hours", () => {
    const draft = upload();
    const visitor = ensureWorkspace(db, "v".repeat(43)).id;
    expect(() => getDraft(db, orders.id, visitor, draft.publicId)).toThrow(NotFoundError);
    expect(() => getDraft(db, orders.id, null, draft.publicId)).toThrow(NotFoundError);
    expect(getDraft(db, orders.id, presenter, draft.publicId).publicId).toBe(draft.publicId);
    expect(() => getDraft(db, orders.id, presenter, draft.publicId, new Date(draft.expiresAt.getTime() + 1))).toThrow(DraftExpiredError);
    expect(() => getDraft(db, orders.id, presenter, draft.publicId, new Date(draft.expiresAt.getTime() + 1))).toThrow("This upload expired after 24 hours. Upload the HAR file again.");
  });

  it("Saving the review: creates the set with a rule for each checked call, moves the bodies, and makes it the default", () => {
    const draft = upload();
    const contents = draftContents(draft, config);
    const session = contents.calls.find((call) => call.pattern === "/v1/session")!;
    // Unchecking POST /v1/session on the page that shows it.
    const reviewed = updateDraft(db, draft, { shown: contents.calls.map((call) => call.key), checked: contents.calls.filter((call) => call !== session && !call.binary).map((call) => call.key) });
    const set = saveDraft(db, reviewed, "Presenter", config);
    expect(set).toMatchObject({ name: "Happy path", source: "har", sourceFile: "orders-portal.chrome.har", ruleCount: 9, createdByName: "Presenter" });
    expect(allRules(db, set.id).map((rule) => rule.pattern)).not.toContain("/v1/session");
    expect(applicationDefault(db, orders.id)?.publicId).toBe(set.publicId);
    expect(fs.existsSync(importDirectory(config, draft.publicId))).toBe(false);
    expect(db.$client.prepare("select count(*) as n from mock_set_imports").get()).toEqual({ n: 0 });
    // No planted secret is in any set file or row.
    const rows = JSON.stringify(db.$client.prepare("select * from mock_rules").all()) + JSON.stringify(db.$client.prepare("select * from mock_sets").all());
    const files = filesUnder(setDirectory(config, set.publicId));
    for (const secret of SECRETS) {
      expect(rows, secret).not.toContain(secret);
      expect(files, secret).not.toContain(secret);
    }
  });

  it("holds no planted secret in any draft file or row", () => {
    const draft = upload();
    const files = filesUnder(importDirectory(config, draft.publicId));
    const rows = JSON.stringify(db.$client.prepare("select * from mock_set_imports").all());
    for (const secret of SECRETS) {
      expect(files, secret).not.toContain(secret);
      expect(rows, secret).not.toContain(secret);
    }
  });

  it("Adding to an existing set: its rules go after the set's own, and the default stays", () => {
    const happy = createSet(db, orders.id, { name: "Happy path" }, null);
    const first = saveDraft(db, upload({ target: happy.publicId, setName: null }), null, config);
    expect(first.ruleCount).toBe(10);
    const before = allRules(db, happy.id).map((rule) => rule.publicId);
    const second = saveDraft(db, upload({ target: happy.publicId, setName: null }), null, config);
    expect(second.ruleCount).toBe(20);
    expect(allRules(db, happy.id).slice(0, 10).map((rule) => rule.publicId)).toEqual(before);
  });

  it("A save that would pass a limit changes nothing", () => {
    const small = withOverrides(config, { previews: { maxMockStorageBytes: 100 } });
    const draft = upload();
    expect(() => saveDraft(db, draft, null, small)).toThrow(/Mock set storage is full/);
    expect(db.$client.prepare("select count(*) as n from mock_sets").get()).toEqual({ n: 0 });
    expect(db.$client.prepare("select count(*) as n from mock_set_imports").get()).toEqual({ n: 1 });
    // A full existing set keeps only the bodies it had.
    const happy = createSet(db, orders.id, { name: "Errors" }, null);
    expect(() => saveDraft(db, upload({ target: happy.publicId, setName: null }), null, small)).toThrow(/Mock set storage is full/);
    expect(fs.existsSync(setDirectory(config, happy.publicId)) ? fs.readdirSync(setDirectory(config, happy.publicId)) : []).toEqual([]);
    expect(findSet(db, orders.id, happy.publicId)!.ruleCount).toBe(0);
  });

  it("asks for the new set's name", () => {
    expect(() => saveDraft(db, upload({ setName: null }), null, config)).toThrow(/name: Enter a name/);
  });

  it("Cancelling the review: deletes the draft, and no file of the upload remains", () => {
    const draft = upload();
    cancelDraft(db, draft, config);
    expect(fs.existsSync(importDirectory(config, draft.publicId))).toBe(false);
    expect(() => getDraft(db, orders.id, presenter, draft.publicId)).toThrow(NotFoundError);
  });
});
