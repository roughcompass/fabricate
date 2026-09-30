import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, StaleRecordError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { standardDrafts, standardReleases, standards } from "@/lib/db/schema";
import { type JsonObject, type JsonValue, dump, parseCanonical } from "@repo-facts/contract";
import { prepareDocument, readDocument } from "@/lib/documents/digested";
import { CURRENT_VERSION, DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";

/**
 * Persistence for the Standard Library: Standards, their single editable
 * draft, and immutable published Releases. Draft content validation and
 * publication rules live in the standards validator and publisher.
 */

export type Standard = typeof standards.$inferSelect;
export type StandardDraft = typeof standardDrafts.$inferSelect;
export type StandardRelease = typeof standardReleases.$inferSelect;

export interface StandardMetadata {
  name: string;
  purpose: string;
}

export function blankDraftDocument(): JsonObject {
  return {
    schema: DOCUMENT_SCHEMAS.standard.name,
    schema_version: CURRENT_VERSION.standard,
    input_schemas: { repository_profile: [CURRENT_VERSION.repositoryProfile], relationship_map: [CURRENT_VERSION.relationshipMap] },
    controls: [],
  };
}

export function createStandard(db: Executor, metadata: StandardMetadata): { standard: Standard; draft: StandardDraft } {
  return immediate(db, (tx) => {
    const values = normalizeMetadata(metadata);
    validateMetadata(tx, values);
    const now = new Date();
    try {
      const standard = tx.insert(standards).values({ ...values, publicId: generatePublicId("std"), createdAt: now, updatedAt: now }).returning().get();
      const draft = tx
        .insert(standardDrafts)
        .values({ standardId: standard.id, document: dump(blankDraftDocument()), createdAt: now, updatedAt: now })
        .returning()
        .get();
      return { standard, draft };
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName(values.name);
      throw error;
    }
  });
}

export function updateStandardMetadata(db: Executor, publicId: string, expectedLockVersion: number, metadata: StandardMetadata): Standard {
  return immediate(db, (tx) => {
    const current = getStandard(tx, publicId);
    const values = normalizeMetadata(metadata);
    validateMetadata(tx, values, current.id);
    try {
      const updated = tx
        .update(standards)
        .set({ ...values, lockVersion: current.lockVersion + 1, updatedAt: new Date() })
        .where(and(eq(standards.id, current.id), eq(standards.lockVersion, expectedLockVersion)))
        .returning()
        .get();
      if (!updated) throw new StaleRecordError(`${current.name} was changed by someone else`);
      return updated;
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName(values.name);
      throw error;
    }
  });
}

export function findStandard(db: Executor, publicId: string): Standard | undefined {
  return db.select().from(standards).where(eq(standards.publicId, publicId)).get();
}

export function getStandard(db: Executor, publicId: string): Standard {
  const standard = findStandard(db, publicId);
  if (!standard) throw new NotFoundError(`Standard ${publicId} does not exist`);
  return standard;
}

export function listStandards(db: Executor): Standard[] {
  return db.select().from(standards).orderBy(sql`lower(${standards.name})`, asc(standards.publicId)).all();
}

export function draftOf(db: Executor, standardId: number): StandardDraft | undefined {
  return db.select().from(standardDrafts).where(eq(standardDrafts.standardId, standardId)).get();
}

export function draftDocument(draft: StandardDraft): JsonObject {
  return parseCanonical(draft.document) as JsonObject;
}

/** Saves a draft's structured document with optimistic locking. */
export function saveDraft(db: Executor, draft: StandardDraft, expectedLockVersion: number, document: JsonValue): StandardDraft {
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new ValidationError([{ field: "document", message: "A draft must be a structured Standard document" }]);
  }
  const updated = db
    .update(standardDrafts)
    .set({ document: dump(document), lockVersion: expectedLockVersion + 1, updatedAt: new Date() })
    .where(and(eq(standardDrafts.id, draft.id), eq(standardDrafts.lockVersion, expectedLockVersion)))
    .returning()
    .get();
  if (!updated) throw new StaleRecordError("This draft was changed by someone else");
  return updated;
}

/** Starts a new draft from a Release. A Standard has at most one draft. */
export function startDraftFromRelease(db: Executor, release: StandardRelease): StandardDraft {
  return immediate(db, (tx) => {
    if (draftOf(tx, release.standardId)) {
      throw new ValidationError([{ field: "base", message: "This Standard already has a draft. Edit or publish it before starting another revision." }]);
    }
    const now = new Date();
    return tx
      .insert(standardDrafts)
      .values({ standardId: release.standardId, basedOnReleaseId: release.id, document: release.document, createdAt: now, updatedAt: now })
      .returning()
      .get();
  });
}

export function deleteDraft(db: Executor, draft: StandardDraft): void {
  db.delete(standardDrafts).where(eq(standardDrafts.id, draft.id)).run();
}

export interface NewRelease {
  standard: Standard;
  document: JsonObject;
  draftLockVersion: number;
  publishedAt?: Date;
}

/** Writes the next immutable Release of a Standard from a canonical document. */
export function insertRelease(db: Executor, input: NewRelease): StandardRelease {
  const inputSchemas = input.document.input_schemas as JsonObject | undefined;
  const versions = (name: string) => {
    const value = inputSchemas?.[name];
    return Array.isArray(value) ? value : [];
  };
  const { text, digest, schemaVersion } = prepareDocument("standard", input.document);

  return immediate(db, (tx) => {
    const latest = tx.select({ version: max(standardReleases.version) }).from(standardReleases).where(eq(standardReleases.standardId, input.standard.id)).get();
    const now = input.publishedAt ?? new Date();
    return tx
      .insert(standardReleases)
      .values({
        publicId: generatePublicId("rel"),
        standardId: input.standard.id,
        version: (latest?.version ?? 0) + 1,
        documentSchemaVersion: schemaVersion,
        document: text,
        digest,
        profileSchemaVersions: dump(versions("repository_profile")),
        relationshipSchemaVersions: dump(versions("relationship_map")),
        draftLockVersion: input.draftLockVersion,
        publishedAt: now,
        createdAt: now,
      })
      .returning()
      .get();
  });
}

export function releasesOf(db: Executor, standardId: number): StandardRelease[] {
  return db.select().from(standardReleases).where(eq(standardReleases.standardId, standardId)).orderBy(desc(standardReleases.version)).all();
}

export function findRelease(db: Executor, publicId: string): StandardRelease | undefined {
  return db.select().from(standardReleases).where(eq(standardReleases.publicId, publicId)).get();
}

export function getRelease(db: Executor, publicId: string): StandardRelease {
  const release = findRelease(db, publicId);
  if (!release) throw new NotFoundError(`Standard Release ${publicId} does not exist`);
  return release;
}

/** Every published Release with its Standard, by Standard name then newest version. */
export function listSelectableReleases(db: Executor): { release: StandardRelease; standard: Standard }[] {
  return db
    .select({ release: standardReleases, standard: standards })
    .from(standardReleases)
    .innerJoin(standards, eq(standards.id, standardReleases.standardId))
    .orderBy(sql`lower(${standards.name})`, desc(standardReleases.version))
    .all();
}

/** The Release document, verified against its published digest. */
export function releaseDocument(release: StandardRelease): JsonObject {
  return readDocument("standard", release, `Standard Release ${release.publicId}`);
}

export function releaseLabel(standard: Pick<Standard, "name">, release: Pick<StandardRelease, "version">): string {
  return `${standard.name} v${release.version}`;
}

function normalizeMetadata(metadata: StandardMetadata): StandardMetadata {
  return { name: metadata.name.replace(/\s+/g, " ").trim(), purpose: metadata.purpose.trim() };
}

function validateMetadata(db: Executor, values: StandardMetadata, excludingId?: number): void {
  const issues = new IssueCollector();
  if (!values.name) issues.add("name", "Enter a name");
  else if (values.name.length > 120) issues.add("name", "Name must be 120 characters or fewer");
  if (!values.purpose) issues.add("purpose", "Describe the Standard's purpose");
  else if (values.purpose.length > 2000) issues.add("purpose", "Purpose must be 2,000 characters or fewer");

  if (values.name) {
    const existing = db.select().from(standards).where(sql`lower(${standards.name}) = lower(${values.name})`).get();
    if (existing && existing.id !== excludingId) issues.add("name", `A Standard named ${existing.name} already exists`);
  }
  issues.throwIfAny();
}

function duplicateName(name: string): ValidationError {
  return new ValidationError([{ field: "name", message: `A Standard named ${name} already exists` }]);
}
