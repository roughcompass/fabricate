import { and, asc, eq, ne, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { type Issue, IssueCollector, NotFoundError, StaleRecordError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { repositorySources } from "@/lib/db/schema";

/**
 * Persistence for repository sources. Callers supply an already parsed and
 * canonicalized clone URL (see clone-url.ts); this layer enforces record rules,
 * the one-entry-per-canonical-URL rule, and optimistic locking.
 */

export type RepositorySource = typeof repositorySources.$inferSelect;

export interface SourceValues {
  name: string;
  cloneUrl: string;
  canonicalUrl: string;
  gitRef?: string | null;
}

/** A branch, tag, or commit name that `git check-ref-format --allow-onelevel` would accept. */
const GIT_REF = /^(?![-/.])(?!.*(?:\.\.|\/\/|@\{|\.lock(?:\/|$)|\/\.))[^\x00-\x20\x7f~^:?*[\\]{1,255}(?<![./])$/;

export function isValidGitRef(value: string): boolean {
  return GIT_REF.test(value) && value !== "@";
}

export function sourceReferenceLabel(source: Pick<RepositorySource, "gitRef">): string {
  return source.gitRef ?? "default branch";
}

export function insertSource(db: Executor, values: SourceValues): RepositorySource {
  return immediate(db, (tx) => {
    const normalized = normalize(values);
    validate(tx, normalized);
    const now = new Date();
    try {
      return tx
        .insert(repositorySources)
        .values({ ...normalized, publicId: generatePublicId("src"), createdAt: now, updatedAt: now })
        .returning()
        .get();
    } catch (error) {
      if (isUniqueViolation(error)) rejectDuplicate(tx, normalized.canonicalUrl);
      throw error;
    }
  });
}

export function updateSource(db: Executor, publicId: string, expectedLockVersion: number, changes: Partial<SourceValues>): RepositorySource {
  return immediate(db, (tx) => {
    const current = getSource(tx, publicId);
    if (current.lockVersion !== expectedLockVersion) throw new StaleRecordError(`${current.name} was changed by someone else`);

    const next = normalize({ ...current, ...changes });
    validate(tx, next, current.id);
    return write(tx, current, next);
  });
}

export function findSource(db: Executor, publicId: string): RepositorySource | undefined {
  return db.select().from(repositorySources).where(eq(repositorySources.publicId, publicId)).get();
}

export function getSource(db: Executor, publicId: string): RepositorySource {
  const source = findSource(db, publicId);
  if (!source) throw new NotFoundError(`Repository source ${publicId} does not exist`);
  return source;
}

export function listSources(db: Executor): RepositorySource[] {
  return db.select().from(repositorySources).orderBy(sql`lower(${repositorySources.name})`, asc(repositorySources.publicId)).all();
}

export function findSourceByCanonicalUrl(db: Executor, canonicalUrl: string, excludingId?: number): RepositorySource | undefined {
  const conditions = [eq(repositorySources.canonicalUrl, canonicalUrl)];
  if (excludingId !== undefined) conditions.push(ne(repositorySources.id, excludingId));
  return db.select().from(repositorySources).where(and(...conditions)).get();
}

function normalize<T extends SourceValues>(values: T): T {
  const gitRef = values.gitRef?.trim();
  return { ...values, name: values.name.replace(/\s+/g, " ").trim(), gitRef: gitRef ? gitRef : null };
}

/** Problems with a source's name and reference, checked without the database. */
export function sourceFieldIssues(values: Pick<SourceValues, "name" | "gitRef">): Issue[] {
  const { name, gitRef } = normalize({ ...values, cloneUrl: "", canonicalUrl: "" });
  const issues: Issue[] = [];
  if (!name) issues.push({ field: "name", message: "Enter a name" });
  else if (name.length > 100) issues.push({ field: "name", message: "Name must be 100 characters or fewer" });
  if (gitRef && !isValidGitRef(gitRef)) issues.push({ field: "gitRef", message: "Reference is not a valid branch, tag, or commit" });
  return issues;
}

function validate(db: Executor, values: SourceValues, excludingId?: number): void {
  const issues = new IssueCollector();
  for (const issue of sourceFieldIssues(values)) issues.add(issue.field, issue.message);
  if (!values.cloneUrl || !values.canonicalUrl) issues.add("cloneUrl", "Enter a clone URL");

  if (values.canonicalUrl) {
    const existing = findSourceByCanonicalUrl(db, values.canonicalUrl, excludingId);
    if (existing) issues.add("cloneUrl", duplicateMessage(existing));
  }
  issues.throwIfAny();
}

function write(db: Executor, current: RepositorySource, next: SourceValues): RepositorySource {
  try {
    const updated = db
      .update(repositorySources)
      .set({
        name: next.name,
        cloneUrl: next.cloneUrl,
        canonicalUrl: next.canonicalUrl,
        gitRef: next.gitRef ?? null,
        lockVersion: current.lockVersion + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(repositorySources.id, current.id), eq(repositorySources.lockVersion, current.lockVersion)))
      .returning()
      .get();
    if (!updated) throw new StaleRecordError(`${current.name} was changed by someone else`);
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) rejectDuplicate(db, next.canonicalUrl, current.id);
    throw error;
  }
}

function rejectDuplicate(db: Executor, canonicalUrl: string, excludingId?: number): never {
  const existing = findSourceByCanonicalUrl(db, canonicalUrl, excludingId);
  throw new ValidationError([{ field: "cloneUrl", message: existing ? duplicateMessage(existing) : "This clone URL is already registered" }]);
}

function duplicateMessage(existing: RepositorySource): string {
  return `This clone URL is already registered as ${existing.name} (${existing.publicId})`;
}
