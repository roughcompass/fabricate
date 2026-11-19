import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { type Issue, IssueCollector, NotFoundError, StaleRecordError, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { repositories } from "@/lib/db/schema";
import { updateLocked } from "@/lib/db/optimistic";

/**
 * Persistence for Repositories. Callers supply an already parsed and
 * canonicalized clone URL (see clone-url.ts); this layer enforces record rules,
 * the one-entry-per-canonical-URL rule, and optimistic locking. A deleted
 * Repository is left out of every lookup here unless one asks for it.
 */

export type Repository = typeof repositories.$inferSelect;

export interface RepositoryValues {
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

export function repositoryReferenceLabel(repository: Pick<Repository, "gitRef">): string {
  return repository.gitRef ?? "default branch";
}

export function insertRepository(db: Executor, values: RepositoryValues): Repository {
  return immediate(db, (tx) => {
    const normalized = normalize(values);
    validate(tx, normalized);
    const now = new Date();
    try {
      return tx
        .insert(repositories)
        .values({ ...normalized, publicId: generatePublicId("src"), createdAt: now, updatedAt: now })
        .returning()
        .get();
    } catch (error) {
      if (isUniqueViolation(error)) rejectDuplicate(tx, normalized.canonicalUrl);
      throw error;
    }
  });
}

export function updateRepository(db: Executor, publicId: string, expectedLockVersion: number, changes: Partial<RepositoryValues>): Repository {
  return immediate(db, (tx) => {
    const current = getRepository(tx, publicId);
    if (current.lockVersion !== expectedLockVersion) throw new StaleRecordError(`${current.name} was changed by someone else`);

    const next = normalize({ ...current, ...changes });
    validate(tx, next, current.id);
    return write(tx, current, next);
  });
}

export function findRepository(db: Executor, publicId: string): Repository | undefined {
  return db.select().from(repositories).where(and(eq(repositories.publicId, publicId), isNull(repositories.deletedAt))).get();
}

/** Which of these Repositories still exist, so history links only the ones whose pages open. */
export function liveRepositoryIds(db: Executor, publicIds: readonly string[]): Set<string> {
  if (publicIds.length === 0) return new Set();
  const rows = db.select({ publicId: repositories.publicId }).from(repositories).where(and(inArray(repositories.publicId, [...new Set(publicIds)]), isNull(repositories.deletedAt))).all();
  return new Set(rows.map((row) => row.publicId));
}

/** A Repository by public ID, deleted or not, for history and for saying what was deleted. */
export function findRepositoryIncludingDeleted(db: Executor, publicId: string): Repository | undefined {
  return db.select().from(repositories).where(eq(repositories.publicId, publicId)).get();
}

/** A Repository by row id, deleted or not, as surveys name it. */
export function repositoryById(db: Executor, id: number): Repository {
  const repository = db.select().from(repositories).where(eq(repositories.id, id)).get();
  if (!repository) throw new NotFoundError(`Repository ${id} does not exist`);
  return repository;
}

export function getRepository(db: Executor, publicId: string): Repository {
  const repository = findRepository(db, publicId);
  if (!repository) throw new NotFoundError(`Repository ${publicId} does not exist`);
  return repository;
}

export function listRepositories(db: Executor): Repository[] {
  return db.select().from(repositories).where(isNull(repositories.deletedAt)).orderBy(sql`lower(${repositories.name})`, asc(repositories.publicId)).all();
}

export function findRepositoryByCanonicalUrl(db: Executor, canonicalUrl: string, excludingId?: number): Repository | undefined {
  const conditions = [eq(repositories.canonicalUrl, canonicalUrl), isNull(repositories.deletedAt)];
  if (excludingId !== undefined) conditions.push(ne(repositories.id, excludingId));
  return db.select().from(repositories).where(and(...conditions)).get();
}

function normalize<T extends RepositoryValues>(values: T): T {
  const gitRef = values.gitRef?.trim();
  return { ...values, name: values.name.replace(/\s+/g, " ").trim(), gitRef: gitRef ? gitRef : null };
}

/** Problems with a Repository's name and reference, checked without the database. */
export function repositoryFieldIssues(values: Pick<RepositoryValues, "name" | "gitRef">): Issue[] {
  const { name, gitRef } = normalize({ ...values, cloneUrl: "", canonicalUrl: "" });
  const issues: Issue[] = [];
  if (!name) issues.push({ field: "name", message: "Enter a name" });
  else if (name.length > 100) issues.push({ field: "name", message: "Name must be 100 characters or fewer" });
  if (gitRef && !isValidGitRef(gitRef)) issues.push({ field: "gitRef", message: "Reference is not a valid branch, tag, or commit" });
  return issues;
}

function validate(db: Executor, values: RepositoryValues, excludingId?: number): void {
  const issues = new IssueCollector();
  for (const issue of repositoryFieldIssues(values)) issues.add(issue.field, issue.message);
  if (!values.cloneUrl || !values.canonicalUrl) issues.add("cloneUrl", "Enter a clone URL");

  if (values.canonicalUrl) {
    const existing = findRepositoryByCanonicalUrl(db, values.canonicalUrl, excludingId);
    if (existing) issues.add("cloneUrl", duplicateMessage(existing));
  }
  issues.throwIfAny();
}

function write(db: Executor, current: Repository, next: RepositoryValues): Repository {
  try {
    return updateLocked(db, repositories, current, { name: next.name, cloneUrl: next.cloneUrl, canonicalUrl: next.canonicalUrl, gitRef: next.gitRef ?? null, updatedAt: new Date() }, `${current.name} was changed by someone else`);
  } catch (error) {
    if (isUniqueViolation(error)) rejectDuplicate(db, next.canonicalUrl, current.id);
    throw error;
  }
}

function rejectDuplicate(db: Executor, canonicalUrl: string, excludingId?: number): never {
  const existing = findRepositoryByCanonicalUrl(db, canonicalUrl, excludingId);
  throw new ValidationError([{ field: "cloneUrl", message: existing ? duplicateMessage(existing) : "This clone URL is already registered" }]);
}

function duplicateMessage(existing: Repository): string {
  return `This clone URL is already registered as ${existing.name} (${existing.publicId})`;
}
