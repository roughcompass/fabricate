import { ENTRY_KINDS, type ReferenceCatalogEntry, sealEntry } from "@repo-facts/contract";
import { beforeEach, describe, expect, it } from "vitest";
import { entryByDigest, entryDocument, storeEntry, storedEntries } from "@/lib/catalog/entries";
import type { Db } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { CATALOG_ENTRY_KINDS } from "@/lib/db/schema";
import { saltEntry } from "../support/catalog";
import { createTestDb } from "../support/db";

describe("stored Reference Catalog entries", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });

  it("keeps the schema's kinds equal to Surveyor's entry contract", () => {
    expect([...CATALOG_ENTRY_KINDS]).toEqual([...ENTRY_KINDS]);
  });

  it("stores an entry once under its digest, with its identity, sources, and packages copied out", () => {
    const salt = saltEntry();
    const { entry, stored } = storeEntry(db, salt);
    expect(stored).toBe(true);
    expect(entry).toMatchObject({ kind: "design_system", entryId: "salt", version: "1.75.0", formatVersion: 1, digest: salt.digest, builtAt: new Date(salt.built_at), buildJobId: null });
    expect(entry.sources.map((source) => source.name)).toEqual(["@salt-ds/core", "@salt-ds/theme", "@salt-ds/icons", "@salt-ds/mcp", "catalog-rules/salt.yaml"]);
    expect(entry.packages[0]).toEqual({ name: "@salt-ds/core", version: "1.75.0" });
    expect(entryDocument(db, salt.digest)).toEqual(salt);
  });

  it("stores nothing for an entry whose digest is stored, such as a rebuild that changed nothing", () => {
    const first = storeEntry(db, saltEntry());
    const rebuilt = sealEntry({ ...saltEntry(), built_at: "2026-11-20T00:00:00.000Z" }) as ReferenceCatalogEntry;
    expect(rebuilt.digest).toBe(saltEntry().digest);
    expect(storeEntry(db, rebuilt)).toEqual({ entry: first.entry, stored: false });
    expect(storedEntries(db)).toHaveLength(1);
  });

  it("stores a rebuilt entry with different content as a new entry, keeping the earlier one", () => {
    const first = storeEntry(db, saltEntry()).entry;
    const { digest: _digest, ...unsealed } = saltEntry();
    const rebuilt = sealEntry({ ...unsealed, content: { ...unsealed.content, neutral_tags: [...(unsealed.content.neutral_tags ?? []), "figure"].sort() } } as never);
    const second = storeEntry(db, rebuilt);
    expect(second.stored).toBe(true);
    expect(second.entry.digest).not.toBe(first.digest);
    expect(storedEntries(db).map((entry) => entry.digest)).toEqual([first.digest, second.entry.digest]);
    expect(entryByDigest(db, first.digest)).toEqual(first);
  });

  it("refuses an entry that fails Surveyor's entry contract, and stores nothing", () => {
    const tampered = { ...saltEntry(), version: "1.76.0" };
    expect(() => storeEntry(db, tampered)).toThrow(ValidationError);
    expect(storedEntries(db)).toEqual([]);
  });
});
