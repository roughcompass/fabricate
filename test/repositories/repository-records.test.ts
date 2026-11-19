import { beforeEach, describe, expect, it } from "vitest";
import { findRepositoryByCanonicalUrl, insertRepository, isValidGitRef, listRepositories, updateRepository } from "@/lib/repositories/repository-records";
import type { Db } from "@/lib/db/client";
import { StaleRecordError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { buildRepository } from "../support/builders";
import { captureValidation } from "../support/validation";
import { createTestDb, rawRun } from "../support/db";

const values = { name: "orders", cloneUrl: "https://git.example.com/acme/orders.git", canonicalUrl: "https://git.example.com/acme/orders" };

describe("repository records", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("creates a source with a stable public id and lock version", () => {
    const repository = insertRepository(db, { ...values, name: "  orders   ui ", gitRef: " main " });

    expect(isPublicId(repository.publicId, "src")).toBe(true);
    expect(repository).toMatchObject({ name: "orders ui", gitRef: "main", lockVersion: 0 });
    expect(repository.createdAt).toBeInstanceOf(Date);
  });

  it("stores a blank reference as the default branch", () => {
    expect(insertRepository(db, { ...values, gitRef: "   " }).gitRef).toBeNull();
  });

  it("reports every invalid field together", () => {
    const error = captureValidation(() => insertRepository(db, { name: " ", cloneUrl: "", canonicalUrl: "", gitRef: "bad..ref" }));

    expect(error.issues.map((issue) => issue.field).sort()).toEqual(["cloneUrl", "gitRef", "name"]);
  });

  it("rejects names over 100 characters", () => {
    expect(captureValidation(() => insertRepository(db, { ...values, name: "x".repeat(101) })).messagesFor("name")).toHaveLength(1);
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

  it("rejects a second source with the same canonical URL and names the existing one", () => {
    const existing = insertRepository(db, values);
    const error = captureValidation(() => insertRepository(db, { ...values, name: "copy", cloneUrl: "https://git.example.com/acme/orders" }));

    expect(error.messagesFor("cloneUrl")[0]).toContain(`orders (${existing.publicId})`);
  });

  it("finds a source by its canonical URL, excluding one when asked", () => {
    const repository = insertRepository(db, values);

    expect(findRepositoryByCanonicalUrl(db, values.canonicalUrl)?.name).toBe("orders");
    expect(findRepositoryByCanonicalUrl(db, values.canonicalUrl, repository.id)).toBeUndefined();
  });

  it("updates with optimistic locking and increments the lock version", () => {
    const repository = insertRepository(db, values);
    const updated = updateRepository(db, repository.publicId, 0, { name: "orders-ui", gitRef: "release" });

    expect(updated).toMatchObject({ name: "orders-ui", gitRef: "release", lockVersion: 1, publicId: repository.publicId });
    expect(() => updateRepository(db, repository.publicId, 0, { name: "stale" })).toThrow(StaleRecordError);
  });

  it("lists sources case-insensitively by name", () => {
    for (const name of ["beta", "Alpha", "gamma"]) buildRepository(db, { name });

    expect(listRepositories(db).map((repository) => repository.name)).toEqual(["Alpha", "beta", "gamma"]);
  });

  describe("database rules", () => {
    const insert = (overrides: Record<string, unknown> = {}) => {
      const row = { public_id: "src_aaaaaaaaaaaaaaaa", name: "raw", clone_url: "https://x/y", canonical_url: "https://x/y", created_at: 0, updated_at: 0, ...overrides };
      rawRun(db, `insert into repository_sources (${Object.keys(row).join(", ")}) values (${Object.keys(row).map(() => "?").join(", ")})`, ...Object.values(row));
    };

    it.each([
      ["a public id with the wrong prefix", { public_id: "ini_aaaaaaaaaaaaaaaa" }],
      ["a blank name", { name: "   " }],
      ["an empty clone URL", { clone_url: "" }],
    ])("rejects %s", (_label, overrides) => {
      expect(() => insert(overrides)).toThrow(/CHECK constraint failed/);
    });

    it("enforces one entry per canonical URL", () => {
      insert();
      expect(() => insert({ public_id: "src_bbbbbbbbbbbbbbbb" })).toThrow(/UNIQUE constraint failed/);
    });

    it("never deletes a source or changes its public identity", () => {
      const repository = insertRepository(db, values);

      expect(() => rawRun(db, "delete from repository_sources where id = ?", repository.id)).toThrow(/never deleted/);
      expect(() => rawRun(db, "update repository_sources set public_id = 'src_zzzzzzzzzzzzzzzz' where id = ?", repository.id)).toThrow(/public identity/);
    });
  });
});
