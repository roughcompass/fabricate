import { beforeEach, describe, expect, it } from "vitest";
import {
  findEnabledSourceByCanonicalUrl,
  insertSource,
  isValidGitRef,
  listSources,
  setSourceEnabled,
  updateSource,
} from "@/lib/catalog/source-records";
import type { Db } from "@/lib/db/client";
import { StaleRecordError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { buildSource } from "../support/builders";
import { captureValidation } from "../support/validation";
import { createTestDb, rawRun } from "../support/db";

const values = { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" };

describe("repository source records", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("creates an enabled source with a stable public id and lock version", () => {
    const source = insertSource(db, { ...values, name: "  orders   ui ", gitRef: " main " });

    expect(isPublicId(source.publicId, "src")).toBe(true);
    expect(source).toMatchObject({ name: "orders ui", gitRef: "main", enabled: true, lockVersion: 0 });
    expect(source.createdAt).toBeInstanceOf(Date);
  });

  it("stores a blank reference as the default branch", () => {
    expect(insertSource(db, { ...values, gitRef: "   " }).gitRef).toBeNull();
  });

  it("reports every invalid field together", () => {
    const error = captureValidation(() => insertSource(db, { name: " ", cloneUrl: "", canonicalUrl: "", gitRef: "bad..ref" }));

    expect(error.issues.map((issue) => issue.field).sort()).toEqual(["cloneUrl", "gitRef", "name"]);
  });

  it("rejects names over 100 characters", () => {
    expect(captureValidation(() => insertSource(db, { ...values, name: "x".repeat(101) })).messagesFor("name")).toHaveLength(1);
  });

  it.each(["main", "release/2026.09", "v1.2.3", "feature/x-y_z", "0123456789abcdef0123456789abcdef01234567"])("accepts the reference %s", (ref) => {
    expect(isValidGitRef(ref)).toBe(true);
  });

  it.each(["-main", "/main", ".hidden", "a..b", "a//b", "a@{1}", "topic.lock", "a/.b", "has space", "a~1", "a^", "a:b", "a?", "a*", "a[b", "a\\b", "ends.", "ends/", "@", "\u0007bell", "x".repeat(256)])(
    "rejects the reference %j",
    (ref) => {
      expect(isValidGitRef(ref)).toBe(false);
    },
  );

  it("rejects a second enabled source with the same canonical URL and names the existing one", () => {
    const existing = insertSource(db, values);
    const error = captureValidation(() => insertSource(db, { ...values, name: "copy", cloneUrl: "https://git.example.com/acme/orders" }));

    expect(error.messagesFor("cloneUrl")[0]).toContain(`orders (${existing.publicId})`);
  });

  it("allows a disabled duplicate but refuses to enable it while the original is enabled", () => {
    insertSource(db, values);
    const duplicate = insertSource(db, { ...values, name: "old copy", enabled: false });

    expect(() => setSourceEnabled(db, duplicate.publicId, true)).toThrow(ValidationError);
    expect(findEnabledSourceByCanonicalUrl(db, values.canonicalUrl)?.name).toBe("orders");
  });

  it("updates with optimistic locking and increments the lock version", () => {
    const source = insertSource(db, values);
    const updated = updateSource(db, source.publicId, 0, { name: "orders-ui", gitRef: "release" });

    expect(updated).toMatchObject({ name: "orders-ui", gitRef: "release", lockVersion: 1, publicId: source.publicId });
    expect(() => updateSource(db, source.publicId, 0, { name: "stale" })).toThrow(StaleRecordError);
  });

  it("disables and re-enables a source", () => {
    const source = insertSource(db, values);

    expect(setSourceEnabled(db, source.publicId, false).enabled).toBe(false);
    expect(listSources(db, { enabled: true })).toEqual([]);
    expect(setSourceEnabled(db, source.publicId, true).enabled).toBe(true);
  });

  it("lists sources case-insensitively by name", () => {
    for (const name of ["beta", "Alpha", "gamma"]) buildSource(db, { name });

    expect(listSources(db).map((source) => source.name)).toEqual(["Alpha", "beta", "gamma"]);
  });

  describe("database rules", () => {
    const insert = (overrides: Record<string, unknown> = {}) => {
      const row = { public_id: "src_aaaaaaaaaaaaaaaa", name: "raw", clone_url: "https://x/y", canonical_url: "https://x/y", enabled: 1, created_at: 0, updated_at: 0, ...overrides };
      rawRun(db, `insert into repository_sources (${Object.keys(row).join(", ")}) values (${Object.keys(row).map(() => "?").join(", ")})`, ...Object.values(row));
    };

    it.each([
      ["a public id with the wrong prefix", { public_id: "ini_aaaaaaaaaaaaaaaa" }],
      ["a blank name", { name: "   " }],
      ["an empty clone URL", { clone_url: "" }],
      ["a non-boolean enabled flag", { enabled: 2 }],
    ])("rejects %s", (_label, overrides) => {
      expect(() => insert(overrides)).toThrow(/CHECK constraint failed/);
    });

    it("enforces one enabled entry per canonical URL", () => {
      insert();
      expect(() => insert({ public_id: "src_bbbbbbbbbbbbbbbb" })).toThrow(/UNIQUE constraint failed/);
      expect(() => insert({ public_id: "src_cccccccccccccccc", enabled: 0 })).not.toThrow();
    });

    it("never deletes a source or changes its public identity", () => {
      const source = insertSource(db, values);

      expect(() => rawRun(db, "delete from repository_sources where id = ?", source.id)).toThrow(/never deleted/);
      expect(() => rawRun(db, "update repository_sources set public_id = 'src_zzzzzzzzzzzzzzzz' where id = ?", source.id)).toThrow(/public identity/);
    });
  });
});
