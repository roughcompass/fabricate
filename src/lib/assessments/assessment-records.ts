import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Repository } from "@/lib/repositories/repository-records";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import {
  SELECTION_MODES,
  type SelectionMode,
  runs,
  assessmentStandardReleases,
  assessmentTargets,
  assessments,
  repositories,
  standardReleases,
  standards,
} from "@/lib/db/schema";
import type { Standard, StandardRelease } from "@/lib/standards/standard-records";
import { countLabel } from "@/components/ui/count";
import { updateLocked } from "@/lib/db/optimistic";

/** The ways an Assessment chooses its Repositories. */
export { SELECTION_MODES } from "@/lib/db/schema";

/**
 * Persistence for Assessments, their explicit repository selections, and
 * their selected Standard Releases.
 *
 * An Assessment of all Repositories records only its policy, never which
 * Repositories exist now. An Assessment of selected Repositories records
 * exactly its selection, each of which must exist.
 *
 * Only published Releases can be selected. Each selection is independent;
 * none takes precedence over another.
 */

export type Assessment = typeof assessments.$inferSelect;

export interface AssessmentInput {
  name: string;
  objective?: string;
  selectionMode: SelectionMode;
  repositoryPublicIds?: readonly string[];
  standardReleasePublicIds?: readonly string[];
}

interface Selections {
  repositories: Repository[];
  releases: StandardRelease[];
}

export function createAssessment(db: Executor, input: AssessmentInput): Assessment {
  return immediate(db, (tx) => {
    const values = normalize(input);
    const selections = validate(tx, values);
    const now = new Date();
    const assessment = tx
      .insert(assessments)
      .values({ publicId: generatePublicId("ini"), name: values.name, objective: values.objective, selectionMode: values.selectionMode, createdAt: now, updatedAt: now })
      .returning()
      .get();
    replaceRepositorySelections(tx, assessment, selections.repositories);
    replaceReleaseSelections(tx, assessment, selections.releases);
    return assessment;
  });
}

export function updateAssessment(db: Executor, publicId: string, expectedLockVersion: number, input: AssessmentInput): Assessment {
  return immediate(db, (tx) => {
    const current = getAssessment(tx, publicId);
    if (current.lockVersion !== expectedLockVersion) throw new StaleRecordError(`${current.name} was changed by someone else`);

    const values = normalize(input);
    const selections = validate(tx, values);

    // Clear selections before the mode changes so the all-Repositories trigger holds.
    if (values.selectionMode === "all") replaceRepositorySelections(tx, current, []);
    const updated = updateLocked(tx, assessments, current, { name: values.name, objective: values.objective, selectionMode: values.selectionMode, updatedAt: new Date() }, `${current.name} was changed by someone else`);
    if (values.selectionMode === "explicit") replaceRepositorySelections(tx, updated, selections.repositories);
    replaceReleaseSelections(tx, updated, selections.releases);
    return updated;
  });
}

/** Deletes an Assessment that has never had a Run. */
export function deleteAssessment(db: Executor, publicId: string): void {
  immediate(db, (tx) => {
    const assessment = getAssessment(tx, publicId);
    const assessed = tx.select({ id: runs.id }).from(runs).where(eq(runs.assessmentId, assessment.id)).limit(1).get();
    if (assessed) {
      throw new ValidationError([{ field: "base", message: `${assessment.name} has Runs and is retained so their history stays reviewable` }]);
    }
    tx.delete(assessments).where(eq(assessments.id, assessment.id)).run();
  });
}

export function findAssessment(db: Executor, publicId: string): Assessment | undefined {
  return db.select().from(assessments).where(eq(assessments.publicId, publicId)).get();
}

export function getAssessment(db: Executor, publicId: string): Assessment {
  const assessment = findAssessment(db, publicId);
  if (!assessment) throw new NotFoundError(`Assessment ${publicId} does not exist`);
  return assessment;
}

export function assessmentById(db: Executor, id: number): Assessment {
  const assessment = db.select().from(assessments).where(eq(assessments.id, id)).get();
  if (!assessment) throw new NotFoundError(`Assessment ${id} does not exist`);
  return assessment;
}

export function listAssessments(db: Executor): Assessment[] {
  return db.select().from(assessments).orderBy(sql`lower(${assessments.name})`, asc(assessments.publicId)).all();
}

/** The explicit selections of an Assessment, by name. */
export function selectedRepositories(db: Executor, assessmentId: number): Repository[] {
  return db
    .select({ source: repositories })
    .from(assessmentTargets)
    .innerJoin(repositories, eq(repositories.id, assessmentTargets.repositoryId))
    .where(eq(assessmentTargets.assessmentId, assessmentId))
    .orderBy(sql`lower(${repositories.name})`, asc(repositories.publicId))
    .all()
    .map((row) => row.source);
}

/** The Releases an Assessment currently selects, by Standard name then version. */
export function selectedReleases(db: Executor, assessmentId: number): { release: StandardRelease; standard: Standard }[] {
  return db
    .select({ release: standardReleases, standard: standards })
    .from(assessmentStandardReleases)
    .innerJoin(standardReleases, eq(standardReleases.id, assessmentStandardReleases.standardReleaseId))
    .innerJoin(standards, eq(standards.id, standardReleases.standardId))
    .where(eq(assessmentStandardReleases.assessmentId, assessmentId))
    .orderBy(sql`lower(${standards.name})`, asc(standardReleases.version))
    .all();
}

export function scopeLabel(assessment: Assessment, selectedCount: number): string {
  if (assessment.selectionMode === "all") return "All Repositories";
  return countLabel(selectedCount, "selected Repository", "selected Repositories");
}

function normalize(input: AssessmentInput): Required<AssessmentInput> {
  const ids = (values: readonly string[] | undefined) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  return {
    name: input.name.replace(/\s+/g, " ").trim(),
    objective: (input.objective ?? "").trim(),
    selectionMode: input.selectionMode,
    repositoryPublicIds: ids(input.repositoryPublicIds),
    standardReleasePublicIds: ids(input.standardReleasePublicIds),
  };
}

function validate(db: Executor, input: Required<AssessmentInput>): Selections {
  const issues = new IssueCollector();
  if (!input.name) issues.add("name", "Enter a name");
  else if (input.name.length > 120) issues.add("name", "Name must be 120 characters or fewer");
  if (input.objective.length > 2000) issues.add("objective", "Objective must be 2,000 characters or fewer");
  if (!SELECTION_MODES.includes(input.selectionMode)) issues.add("selectionMode", "Choose all Repositories or selected Repositories");

  let selected: Repository[] = [];
  if (input.selectionMode === "explicit") {
    const ids = input.repositoryPublicIds;
    const found = ids.length ? db.select().from(repositories).where(and(inArray(repositories.publicId, [...ids]), isNull(repositories.deletedAt))).all() : [];
    const byPublicId = new Map(found.map((repository) => [repository.publicId, repository]));
    for (const publicId of ids) {
      const repository = byPublicId.get(publicId);
      if (!repository) issues.add("sources", `Repository ${publicId} does not exist`);
    }
    if (ids.length === 0) issues.add("sources", "Select at least one Repository for an explicit scope");
    selected = ids.flatMap((publicId) => byPublicId.get(publicId) ?? []);
  }

  const releaseIds = input.standardReleasePublicIds;
  const releases = releaseIds.length ? db.select().from(standardReleases).where(inArray(standardReleases.publicId, [...releaseIds])).all() : [];
  const releasesByPublicId = new Map(releases.map((release) => [release.publicId, release]));
  const missing = releaseIds.filter((publicId) => !releasesByPublicId.has(publicId));
  const drafts = missing.length ? new Map(db.select().from(standards).where(inArray(standards.publicId, missing)).all().map((standard) => [standard.publicId, standard])) : new Map();
  for (const publicId of missing) {
    const standard = drafts.get(publicId);
    issues.add(
      "standardReleases",
      standard ? `${standard.name} is a draft Standard; select one of its published Releases` : `${publicId} is not a published Standard Release`,
    );
  }

  issues.throwIfAny();
  return { repositories: selected, releases: releaseIds.flatMap((publicId) => releasesByPublicId.get(publicId) ?? []) };
}

function replaceRepositorySelections(db: Executor, assessment: Assessment, repositories: readonly Repository[]): void {
  const wanted = new Set(repositories.map((repository) => repository.id));
  const existing = db.select().from(assessmentTargets).where(eq(assessmentTargets.assessmentId, assessment.id)).all();
  const existingIds = new Set(existing.map((target) => target.repositoryId));

  const removed = existing.filter((target) => !wanted.has(target.repositoryId)).map((target) => target.id);
  if (removed.length) db.delete(assessmentTargets).where(inArray(assessmentTargets.id, removed)).run();

  const added = repositories.filter((repository) => !existingIds.has(repository.id));
  const now = new Date();
  if (added.length) {
    db.insert(assessmentTargets)
      .values(added.map((repository) => ({ assessmentId: assessment.id, repositoryId: repository.id, createdAt: now })))
      .run();
  }
}

function replaceReleaseSelections(db: Executor, assessment: Assessment, releases: readonly StandardRelease[]): void {
  const wanted = new Set(releases.map((release) => release.id));
  const existing = db.select().from(assessmentStandardReleases).where(eq(assessmentStandardReleases.assessmentId, assessment.id)).all();
  const existingIds = new Set(existing.map((selection) => selection.standardReleaseId));

  const removed = existing.filter((selection) => !wanted.has(selection.standardReleaseId)).map((selection) => selection.id);
  if (removed.length) db.delete(assessmentStandardReleases).where(inArray(assessmentStandardReleases.id, removed)).run();

  const added = releases.filter((release) => !existingIds.has(release.id));
  const now = new Date();
  if (added.length) {
    db.insert(assessmentStandardReleases)
      .values(added.map((release) => ({ assessmentId: assessment.id, standardReleaseId: release.id, createdAt: now })))
      .run();
  }
}
