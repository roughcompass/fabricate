import { eq } from "drizzle-orm";
import type { Assessment } from "@/lib/assessments/assessment-records";
import type { Executor } from "@/lib/db/client";
import { IssueCollector } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { relationshipMaps } from "@/lib/db/schema";
import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { prepareDocument, readDocument } from "@/lib/documents/digested";

/** Persistence for the immutable Relationship Map, one per Assessment. */

export type RelationshipMap = typeof relationshipMaps.$inferSelect;

export interface NewRelationshipMap {
  assessment: Assessment;
  document: JsonValue | string;
  /** Structural validation of the document contract; returns problems. */
  validate?: (document: JsonObject) => string[];
}

export function insertRelationshipMap(db: Executor, input: NewRelationshipMap): RelationshipMap {
  const prepared = prepareDocument("relationshipMap", input.document);
  const resolverVersion = prepared.value.resolver_version;
  const issues = new IssueCollector();
  if (typeof resolverVersion !== "string" || !resolverVersion) issues.add("document", "The map must record its resolver version");
  for (const problem of input.validate?.(prepared.value) ?? []) issues.add("document", problem);
  issues.throwIfAny();

  return db
    .insert(relationshipMaps)
    .values({
      publicId: generatePublicId("map"),
      assessmentId: input.assessment.id,
      schemaVersion: prepared.schemaVersion,
      resolverVersion: resolverVersion as string,
      document: prepared.text,
      digest: prepared.digest,
      createdAt: new Date(),
    })
    .returning()
    .get();
}

export function mapOf(db: Executor, assessmentId: number): RelationshipMap | undefined {
  return db.select().from(relationshipMaps).where(eq(relationshipMaps.assessmentId, assessmentId)).get();
}

/** The map document, verified against its digest. */
export function mapDocument(map: RelationshipMap): JsonObject {
  return readDocument("relationshipMap", map, `Relationship Map ${map.publicId}`);
}
