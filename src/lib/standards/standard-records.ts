import { and, asc, desc, eq, isNull, max, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, StaleRecordError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { standardReleases, standards } from "@/lib/db/schema";
import { type JsonObject, type JsonValue, dump, parseCanonical } from "@repo-facts/contract";
import { prepareDocument, readDocument } from "@/lib/documents/digested";
import { CURRENT_VERSION, DOCUMENT_SCHEMAS } from "@/lib/documents/schemas";
import { updateLocked } from "@/lib/db/optimistic";

/**
 * Persistence for the Standard Library: Standards, their single editable
 * draft, and immutable published Releases. A draft lives in its Standard's
 * draft columns. Draft content validation and publication rules live in the
 * standards validator and publisher.
 */

export type Standard = typeof standards.$inferSelect;
export type StandardRelease = typeof standardReleases.$inferSelect;

/** A Standard's working copy, read from its draft columns. */
export interface StandardDraft {
  standardId: number;
  document: string;
  lockVersion: number;
  savedAt: Date;
  basedOnReleaseId: number | null;
}

function draftOfStandard(standard: Standard): StandardDraft | undefined {
  if (standard.draftDocument === null || standard.draftLockVersion === null || standard.draftSavedAt === null) return undefined;
  return { standardId: standard.id, document: standard.draftDocument, lockVersion: standard.draftLockVersion, savedAt: standard.draftSavedAt, basedOnReleaseId: standard.draftBasedOnReleaseId };
}

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

/** Creates a Standard and its draft: blank, or +document+, such as a starter's. */
export function createStandard(db: Executor, metadata: StandardMetadata, document: JsonObject = blankDraftDocument()): { standard: Standard; draft: StandardDraft } {
  return immediate(db, (tx) => {
    const values = normalizeMetadata(metadata);
    validateMetadata(tx, values);
    const now = new Date();
    try {
      const standard = tx
        .insert(standards)
        .values({ ...values, publicId: generatePublicId("std"), draftDocument: dump(document), draftLockVersion: 0, draftSavedAt: now, createdAt: now, updatedAt: now })
        .returning()
        .get();
      return { standard, draft: draftOfStandard(standard)! };
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
      return updateLocked(tx, standards, current, { ...values, updatedAt: new Date() }, `${current.name} was changed by someone else`, { expected: expectedLockVersion });
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
  const standard = db.select().from(standards).where(eq(standards.id, standardId)).get();
  return standard && draftOfStandard(standard);
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
    .update(standards)
    .set({ draftDocument: dump(document), draftLockVersion: expectedLockVersion + 1, draftSavedAt: new Date() })
    .where(and(eq(standards.id, draft.standardId), eq(standards.draftLockVersion, expectedLockVersion)))
    .returning()
    .get();
  if (!updated) throw new StaleRecordError("This draft was changed by someone else");
  return draftOfStandard(updated)!;
}

/** Starts a new draft from a Release, with +document+ as its content (default: the Release's). A Standard has at most one draft. */
export function startDraftFromRelease(db: Executor, release: StandardRelease, document?: JsonObject): StandardDraft {
  return immediate(db, (tx) => {
    if (draftOf(tx, release.standardId)) {
      throw new ValidationError([{ field: "base", message: "This Standard already has a draft. Edit or publish it before starting another revision." }]);
    }
    const started = tx
      .update(standards)
      .set({ draftDocument: document ? dump(document) : release.document, draftLockVersion: 0, draftSavedAt: new Date(), draftBasedOnReleaseId: release.id })
      .where(and(eq(standards.id, release.standardId), isNull(standards.draftDocument)))
      .returning()
      .get();
    return draftOfStandard(started!)!;
  });
}

export function deleteDraft(db: Executor, draft: StandardDraft): void {
  db.update(standards).set({ draftDocument: null, draftLockVersion: null, draftSavedAt: null, draftBasedOnReleaseId: null }).where(eq(standards.id, draft.standardId)).run();
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
        profileSchemaVersions: versions("repository_profile").map(Number),
        relationshipSchemaVersions: versions("relationship_map").map(Number),
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

export function standardById(db: Executor, id: number): Standard {
  const standard = db.select().from(standards).where(eq(standards.id, id)).get();
  if (!standard) throw new NotFoundError(`Standard ${id} does not exist`);
  return standard;
}

export function releaseById(db: Executor, id: number): StandardRelease {
  const release = db.select().from(standardReleases).where(eq(standardReleases.id, id)).get();
  if (!release) throw new NotFoundError(`Standard Release ${id} does not exist`);
  return release;
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
