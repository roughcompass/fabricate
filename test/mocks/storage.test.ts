import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FrontendRegistryConfig, getConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { MOCK_IMPORTS_DIRECTORY, MOCK_SETS_DIRECTORY, digestOf, discardDirectory, importDirectory, readBody, removeUnusedBodies, setDirectory, sweepMockStorage, writeBody } from "@/lib/mocks/storage";
import { createSet } from "@/lib/mocks/records";
import { ensureWorkspace } from "@/lib/workspaces/workspaces";
import { createTestDb } from "../support/db";
import { viewedApplicationIn } from "../support/views";

/*
 * Body storage (add-mock-sets, design decision 9, task 2.3): bodies are
 * content-addressed files under `.mock-sets/` and `.mock-imports/` in
 * preview storage, written through a temporary name and removed through
 * `.trash/`, and the sweep removes what no row owns, leaving the package
 * caches and previews alone.
 */

describe("mock set storage", () => {
  let db: Db;
  let storage: string;
  let config: FrontendRegistryConfig;

  beforeEach(() => {
    db = createTestDb();
    storage = fs.mkdtempSync(path.join(os.tmpdir(), "mock-storage-"));
    config = withOverrides(getConfig(), { previews: { storage } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    db.$client.close();
    fs.rmSync(storage, { recursive: true, force: true });
  });

  it("keeps bodies under .mock-sets/ and drafts under .mock-imports/ in preview storage", () => {
    expect(setDirectory(config, "mks_0000000000000001")).toBe(path.join(storage, MOCK_SETS_DIRECTORY, "mks_0000000000000001"));
    expect(importDirectory(config, "mki_0000000000000001")).toBe(path.join(storage, MOCK_IMPORTS_DIRECTORY, "mki_0000000000000001"));
    expect([MOCK_SETS_DIRECTORY, MOCK_IMPORTS_DIRECTORY]).toEqual([".mock-sets", ".mock-imports"]);
    expect(() => setDirectory(config, "../pvw_0000000000000001")).toThrow(/not a mock set id/);
  });

  it("stores identical bodies once, by their digest", () => {
    const directory = setDirectory(config, "mks_0000000000000001");
    const body = new TextEncoder().encode('{"orders":[]}');
    const first = writeBody(directory, body);
    const second = writeBody(directory, new Uint8Array(body));
    expect(first).toEqual(second);
    expect(first.digest).toBe(digestOf(body));
    expect(fs.readdirSync(directory)).toEqual([first.digest]);
    expect(readBody(directory, first.digest)?.toString()).toBe('{"orders":[]}');
    expect(readBody(directory, "nope")).toBeNull();
  });

  it("leaves no partial file after a failed write", () => {
    const directory = setDirectory(config, "mks_0000000000000001");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => writeBody(directory, new TextEncoder().encode("partial"))).toThrow("disk full");
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("removes the bodies no rule names, and temporary files a failed write left", () => {
    const directory = setDirectory(config, "mks_0000000000000001");
    const kept = writeBody(directory, new TextEncoder().encode("kept"));
    writeBody(directory, new TextEncoder().encode("unused"));
    fs.writeFileSync(path.join(directory, `${kept.digest}.abc.tmp`), "left");
    removeUnusedBodies(directory, new Set([kept.digest]));
    expect(fs.readdirSync(directory)).toEqual([kept.digest]);
  });

  it("deletes a directory through .trash/, leaving nothing at its path", async () => {
    const directory = setDirectory(config, "mks_0000000000000001");
    writeBody(directory, new TextEncoder().encode("body"));
    discardDirectory(config, directory);
    expect(fs.existsSync(directory)).toBe(false);
    await vi.waitFor(() => expect(fs.readdirSync(path.join(storage, ".trash"))).toEqual([]));
  });

  it("sweeps an orphaned set and an expired draft, and leaves the caches, previews, and live sets alone", async () => {
    const application = viewedApplicationIn(db, "Orders portal");
    const live = createSet(db, application.id, { name: "Happy path" }, null);
    writeBody(setDirectory(config, live.publicId), new TextEncoder().encode("live"));
    const orphan = setDirectory(config, "mks_0000000000000099");
    writeBody(orphan, new TextEncoder().encode("orphan"));
    const workspace = ensureWorkspace(db, "s".repeat(43)).id;
    const now = new Date("2026-11-20T12:00:00Z");
    const draft = (publicId: string, expiresAt: Date) => {
      db.$client.prepare("insert into mock_set_imports (public_id, application_id, workspace_id, file_name, entry_count, created_at, expires_at) values (?, ?, ?, 'orders-portal.har', 24, ?, ?)").run(publicId, application.id, workspace, expiresAt.getTime() - 86_400_000, expiresAt.getTime());
      fs.mkdirSync(importDirectory(config, publicId), { recursive: true });
      fs.writeFileSync(path.join(importDirectory(config, publicId), "calls.json"), "[]");
    };
    draft("mki_0000000000000001", new Date(now.getTime() - 1));
    draft("mki_0000000000000002", new Date(now.getTime() + 3_600_000));
    for (const other of [".cache/npm", "pvw_0000000000000001/out/1-a"]) {
      fs.mkdirSync(path.join(storage, other), { recursive: true });
      fs.writeFileSync(path.join(storage, other, "file"), "kept");
    }

    expect(await sweepMockStorage(db, config, now)).toBe(2);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(importDirectory(config, "mki_0000000000000001"))).toBe(false);
    expect(fs.existsSync(importDirectory(config, "mki_0000000000000002"))).toBe(true);
    expect(fs.readdirSync(setDirectory(config, live.publicId))).toHaveLength(1);
    expect(db.$client.prepare("select public_id from mock_set_imports").all()).toEqual([{ public_id: "mki_0000000000000002" }]);
    expect(fs.readFileSync(path.join(storage, ".cache/npm/file"), "utf8")).toBe("kept");
    expect(fs.readFileSync(path.join(storage, "pvw_0000000000000001/out/1-a/file"), "utf8")).toBe("kept");
  });
});
