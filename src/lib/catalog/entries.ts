import { type JsonObject, type ReferenceCatalogEntry, canonicalEntry, entryProblems, parseCanonical } from "@repo-facts/contract";
import { asc, eq, getTableColumns } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { catalogEntries } from "@/lib/db/schema";

/*
 * Stored Reference Catalog entries (establish-frontend-registry, design
 * decision 5). An entry is stored once, under its digest, and never changes:
 * storing an entry whose digest is already stored stores nothing.
 */

export type CatalogEntryRow = typeof catalogEntries.$inferSelect;
/** A stored entry without its document, which is read only to supply it to a survey. */
export type StoredEntry = Omit<CatalogEntryRow, "document">;

const { document: _document, ...summaryColumns } = getTableColumns(catalogEntries);

export interface Stored {
  entry: StoredEntry;
  /** Whether this call stored it: false when an entry with its digest was already stored. */
  stored: boolean;
}

/** Stores +entry+, validated against Surveyor's entry contract, unless an entry with its digest is already stored. */
export function storeEntry(db: Executor, entry: ReferenceCatalogEntry, options: { buildJobId?: number | null; now?: Date } = {}): Stored {
  const problems = entryProblems(entry);
  if (problems.length) throw new ValidationError(problems.map((message) => ({ field: "entry", message })));
  const existing = entryByDigest(db, entry.digest);
  if (existing) return { entry: existing, stored: false };
  const inserted = db
    .insert(catalogEntries)
    .values({
      kind: entry.kind,
      entryId: entry.id,
      version: entry.version,
      formatVersion: entry.format_version,
      digest: entry.digest,
      document: canonicalEntry(entry),
      builtAt: new Date(entry.built_at),
      sources: entry.sources.map((source) => ({ ...source, sections: [...source.sections] })),
      packages: entry.packages.map((item) => ({ ...item })),
      buildJobId: options.buildJobId ?? null,
      createdAt: options.now ?? new Date(),
    })
    .onConflictDoNothing({ target: catalogEntries.digest })
    .returning(summaryColumns)
    .get();
  return inserted ? { entry: inserted, stored: true } : { entry: entryByDigest(db, entry.digest)!, stored: false };
}

export function entryByDigest(db: Executor, digest: string): StoredEntry | undefined {
  return db.select(summaryColumns).from(catalogEntries).where(eq(catalogEntries.digest, digest)).get();
}

/** Every stored entry, without documents, oldest first. */
export function storedEntries(db: Executor): StoredEntry[] {
  return db.select(summaryColumns).from(catalogEntries).orderBy(asc(catalogEntries.id)).all();
}

/**
 * The stored document of the entry with +digest+, parsed.
 * @public Tests read stored entries through this.
 */
export function entryDocument(db: Executor, digest: string): JsonObject | undefined {
  const row = db.select({ document: catalogEntries.document }).from(catalogEntries).where(eq(catalogEntries.digest, digest)).get();
  return row ? (parseCanonical(row.document) as JsonObject) : undefined;
}
