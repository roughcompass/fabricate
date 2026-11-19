import { ENTRY_FORMAT_VERSION } from "@repo-facts/contract";
import type { Executor } from "@/lib/db/client";
import type { StoredEntryPackage } from "@/lib/db/schema";
import { type CatalogConfiguration, type DescribedThing, thingKey } from "./configuration";
import { type StoredEntry, storedEntries } from "./entries";

/*
 * The current Reference Catalog (establish-frontend-registry, design
 * decisions 2 and 6): for each described thing, one entry per version, the
 * one surveys are given. A version rebuilt with different content has
 * several entries; the current one is the newest built from the team's
 * rules as they stand, or, when none was, the newest. So a rebuild after the
 * rules were reverted makes the earlier entry current again without storing
 * it twice.
 */

/** A current entry, as `selectEntry` reads it: without its content. */
export interface EntrySummary {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly format_version: number;
  readonly digest: string;
  readonly built_at: string;
  readonly packages: readonly StoredEntryPackage[];
}

export interface CurrentCatalog {
  /** The described things that have a current entry, such as `design_system:salt`, sorted. */
  readonly things: readonly string[];
  readonly entries: readonly EntrySummary[];
}

/** The version of the team's rules +entry+ was built from, when its sources record one. */
export function rulesVersionOf(entry: Pick<StoredEntry, "entryId" | "sources">): string | null {
  return entry.sources.find((source) => source.name === `catalog-rules/${entry.entryId}.yaml`)?.version ?? null;
}

/** The stored entries of +thing+, by version, oldest first within each. */
export function entriesByVersion(entries: readonly StoredEntry[], thing: DescribedThing): Map<string, StoredEntry[]> {
  const byVersion = new Map<string, StoredEntry[]>();
  for (const entry of entries) {
    if (entry.kind !== thing.kind || entry.entryId !== thing.id || entry.formatVersion !== ENTRY_FORMAT_VERSION) continue;
    byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), entry]);
  }
  return byVersion;
}

/** The current entry among one version's +entries+ of +thing+, oldest first. */
function currentOf(entries: readonly StoredEntry[], thing: DescribedThing): StoredEntry {
  const ruled = entries.filter((entry) => rulesVersionOf(entry) === thing.rules.version);
  return (ruled.length ? ruled : entries).at(-1)!;
}

/** The current entry of each version of each thing +catalog+ describes. Reads no entry documents. */
export function currentCatalog(db: Executor, catalog: CatalogConfiguration, stored: readonly StoredEntry[] = storedEntries(db)): CurrentCatalog {
  const entries: EntrySummary[] = [];
  const things: string[] = [];
  for (const thing of catalog.things) {
    const byVersion = entriesByVersion(stored, thing);
    if (byVersion.size) things.push(thingKey(thing));
    for (const versions of byVersion.values()) entries.push(summaryOf(currentOf(versions, thing)));
  }
  return { things: things.sort(), entries };
}

function summaryOf(entry: StoredEntry): EntrySummary {
  return { kind: entry.kind, id: entry.entryId, version: entry.version, format_version: entry.formatVersion, digest: entry.digest, built_at: entry.builtAt.toISOString(), packages: entry.packages };
}
