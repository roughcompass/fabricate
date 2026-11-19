import { ENTRY_FORMAT_VERSION } from "@repo-facts/contract";
import type { DescribedThing } from "./configuration";
import type { StoredEntry } from "./entries";

/*
 * The current Reference Catalog (establish-frontend-registry, design
 * decisions 2 and 6): for each described thing, one entry per version, the
 * one surveys are given. A version rebuilt with different content has
 * several entries; the current one is the newest built from the team's
 * rules as they stand, or, when none was, the newest. So a rebuild after the
 * rules were reverted makes the earlier entry current again without storing
 * it twice.
 */

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
