import type { JsonObject } from "@repo-facts/contract";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Executor } from "@/lib/db/client";
import { catalogConfiguration } from "./configuration";
import { type CurrentCatalog, currentCatalog } from "./current";
import { entryDocument } from "./entries";

/*
 * Entries for surveys (establish-frontend-registry, design decision 2): each
 * survey is given every current entry of each described thing, and Surveyor
 * picks the one for the version the Repository uses. Entries are read from
 * the database and kept in the worker's memory by digest, so a survey
 * downloads nothing and reads only entries it hasn't read before. Entries
 * that stop being current leave the cache.
 */

class EntryCache {
  private readonly documents = new Map<string, JsonObject>();
  /** How many entry documents have been read from the database. */
  reads = 0;

  /** The documents of +digests+, read once each, keeping only these. */
  documentsOf(db: Executor, digests: readonly string[]): JsonObject[] {
    const documents = digests.map((digest) => {
      let document = this.documents.get(digest);
      if (!document) {
        document = entryDocument(db, digest);
        if (!document) throw new Error(`Reference Catalog entry ${digest} isn't stored`);
        this.reads += 1;
        this.documents.set(digest, document);
      }
      return document;
    });
    const kept = new Set(digests);
    for (const digest of this.documents.keys()) if (!kept.has(digest)) this.documents.delete(digest);
    return documents;
  }

  /** Forgets every entry, so the next survey reads the ones it's given again. */
  clear(): void {
    this.documents.clear();
  }
}

/** The worker's cache of entry documents. */
export const entryCache = new EntryCache();

export interface SuppliedEntries {
  /** The current entries, as stored, for Surveyor. */
  readonly entries: readonly JsonObject[];
  /** The current Catalog they come from. */
  readonly catalog: CurrentCatalog;
}

/** Every current entry of every described thing, for a survey. */
export function suppliedEntries(db: Executor, config: FrontendRegistryConfig): SuppliedEntries {
  const catalog = currentCatalog(db, catalogConfiguration(config));
  return { entries: entryCache.documentsOf(db, catalog.entries.map((entry) => entry.digest)), catalog };
}
