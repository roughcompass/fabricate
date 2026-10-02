import { asc, eq } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { dependencyFacts, evidenceIndex, graphEdgeCandidates, graphEdges, graphNodes, projectionCoverage, projectionState, relationshipMaps, repositoryProfiles } from "@/lib/db/schema";
import { DocumentIntegrityError } from "@/lib/documents/digested";
import { profileDocument } from "@/lib/profiles/profile-records";
import { mapDocument } from "@/lib/relationships/map-records";
import { projectMap, projectProfile } from "./project";

export interface SkippedDocument {
  kind: "profile" | "map";
  publicId: string;
  reason: string;
}

export interface RebuildReport {
  profiles: number;
  maps: number;
  skipped: SkippedDocument[];
}

/**
 * Drops the projection and recreates it from the stored documents, in one
 * transaction. Each document's digest is verified first; a document that no
 * longer matches is reported and left out rather than projected. Concept
 * classifications are rebuilt by the ontology importer, so they're kept.
 */
export function rebuildProjection(db: Executor): RebuildReport {
  return immediate(db, (tx) => {
    tx.update(projectionState).set({ rebuilding: true }).where(eq(projectionState.id, 1)).run();
    for (const table of [projectionCoverage, graphEdgeCandidates, graphEdges, graphNodes, evidenceIndex, dependencyFacts]) tx.delete(table).run();

    const report: RebuildReport = { profiles: 0, maps: 0, skipped: [] };
    // Documents can be tens of MB, so they're read one at a time.
    for (const { id } of tx.select({ id: repositoryProfiles.id }).from(repositoryProfiles).orderBy(asc(repositoryProfiles.id)).all()) {
      const profile = tx.select().from(repositoryProfiles).where(eq(repositoryProfiles.id, id)).get()!;
      const document = verified(() => profileDocument(profile), { kind: "profile", publicId: profile.publicId }, report);
      if (!document) continue;
      projectProfile(tx, profile, document);
      report.profiles++;
    }
    for (const { id } of tx.select({ id: relationshipMaps.id }).from(relationshipMaps).orderBy(asc(relationshipMaps.id)).all()) {
      const map = tx.select().from(relationshipMaps).where(eq(relationshipMaps.id, id)).get()!;
      const document = verified(() => mapDocument(map), { kind: "map", publicId: map.publicId }, report);
      if (!document) continue;
      projectMap(tx, map, document);
      report.maps++;
    }

    tx.update(projectionState).set({ rebuilding: false }).where(eq(projectionState.id, 1)).run();
    return report;
  });
}

function verified<T>(read: () => T, document: Omit<SkippedDocument, "reason">, report: RebuildReport): T | undefined {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof DocumentIntegrityError)) throw error;
    report.skipped.push({ ...document, reason: error.message });
    return undefined;
  }
}
