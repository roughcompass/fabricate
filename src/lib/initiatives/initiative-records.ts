import { and, asc, eq, inArray, isNotNull, isNull, not, sql } from "drizzle-orm";
import type { RepositorySource } from "@/lib/catalog/source-records";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import {
  SELECTION_MODES,
  type SelectionMode,
  assessments,
  initiativeStandardReleases,
  initiativeTargets,
  initiatives,
  repositorySources,
  standardReleases,
  standards,
} from "@/lib/db/schema";
import type { Standard, StandardRelease } from "@/lib/standards/standard-records";

/**
 * Persistence for initiatives, their explicit repository selections, and
 * their selected Standard Releases.
 *
 * An all-enabled initiative records only its policy, never the catalog's
 * current membership. An explicit initiative records exactly its selected
 * sources. Newly selected sources must exist and be enabled; a source that was
 * selected earlier and has since been disabled stays selected so that starting
 * an Assessment can report it instead of silently narrowing the scope.
 *
 * Only published Releases can be selected. Each selection is independent;
 * none takes precedence over another.
 */

export type Initiative = typeof initiatives.$inferSelect;

export interface InitiativeInput {
  name: string;
  objective?: string;
  selectionMode: SelectionMode;
  sourcePublicIds?: readonly string[];
  standardReleasePublicIds?: readonly string[];
}

interface Selections {
  sources: RepositorySource[];
  releases: StandardRelease[];
}

export function createInitiative(db: Executor, input: InitiativeInput): Initiative {
  return immediate(db, (tx) => {
    const values = normalize(input);
    const selections = validate(tx, values, new Set());
    const now = new Date();
    const initiative = tx
      .insert(initiatives)
      .values({ publicId: generatePublicId("ini"), name: values.name, objective: values.objective, selectionMode: values.selectionMode, createdAt: now, updatedAt: now })
      .returning()
      .get();
    replaceSourceSelections(tx, initiative, selections.sources);
    replaceReleaseSelections(tx, initiative, selections.releases);
    return initiative;
  });
}

/**
 * The system-owned initiative that assesses +source+ alone for claims,
 * created on first use and reused afterward (design decision 4).
 */
export function claimInitiative(db: Executor, source: RepositorySource): Initiative {
  return immediate(db, (tx) => {
    const existing = tx.select().from(initiatives).where(eq(initiatives.claimRepositorySourceId, source.id)).get();
    if (existing) return existing;
    const now = new Date();
    const initiative = tx
      .insert(initiatives)
      .values({
        publicId: generatePublicId("ini"),
        name: `Claim: ${source.name}`,
        objective: "Assesses one claimed repository. The system created it, and reuses it for later claims.",
        selectionMode: "explicit",
        claimRepositorySourceId: source.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    replaceSourceSelections(tx, initiative, [source]);
    return initiative;
  });
}

/** Whether the system created +initiative+: for a claim, the Salt Patterns initiative, or the Repository profiling initiative. */
export function isSystemOwned(initiative: Pick<Initiative, "claimRepositorySourceId" | "systemOwned" | "profiling">): boolean {
  return initiative.claimRepositorySourceId !== null || initiative.systemOwned || initiative.profiling;
}

/**
 * The Repository profiling initiative, which migration 0038 seeds: DE FabLab
 * owns it, and each of its Runs profiles one repository as that repository's
 * next profile version (docs/profiling.md). It has no Releases and no page of
 * its own; its Runs are shown under Repositories.
 */
export const PROFILING_INITIATIVE_ID = "ini_repoprofiling000";

export const PROFILING_FIXED = "DE FabLab owns Repository profiling: its name, objective, scope, and Releases can't change";

export function profilingInitiative(db: Executor): Initiative {
  return getInitiative(db, PROFILING_INITIATIVE_ID);
}

export const SALT_PATTERNS_FIXED = "DE FabLab owns Salt Patterns: its name, objective, and template targets can't change, but you can choose its Releases";

/**
 * The Salt Patterns initiative, which the migration seeds: DE FabLab owns it,
 * and its targets are the template versions it assesses
 * (converge-templates-and-prototypes, design decision 2).
 */
export const SALT_PATTERNS_INITIATIVE_ID = "ini_saltpatterns0000";

export function saltPatternsInitiative(db: Executor): Initiative {
  return getInitiative(db, SALT_PATTERNS_INITIATIVE_ID);
}

/** A claim's initiative keeps its one repository, though its name and Releases can change; Salt Patterns changes only its Releases. */
function refuseScopeChange(db: Executor, initiative: Initiative, input: Required<InitiativeInput>): void {
  if (initiative.systemOwned) throw new ValidationError([{ field: "base", message: SALT_PATTERNS_FIXED }]);
  if (initiative.profiling) throw new ValidationError([{ field: "base", message: PROFILING_FIXED }]);
  if (initiative.claimRepositorySourceId === null) return;
  const own = selectedSources(db, initiative.id).map((source) => source.publicId);
  if (input.selectionMode !== "explicit" || input.sourcePublicIds.length !== 1 || input.sourcePublicIds[0] !== own[0]) {
    throw new ValidationError([{ field: "sources", message: "This Assessment was created for a claimed Repository, and its scope can't change" }]);
  }
}

export function updateInitiative(db: Executor, publicId: string, expectedLockVersion: number, input: InitiativeInput): Initiative {
  return immediate(db, (tx) => {
    const current = getInitiative(tx, publicId);
    if (current.lockVersion !== expectedLockVersion) throw new StaleRecordError(`${current.name} was changed by someone else`);

    const values = normalize(input);
    refuseScopeChange(tx, current, values);
    const previouslySelected = new Set(selectedSources(tx, current.id).map((source) => source.id));
    const selections = validate(tx, values, previouslySelected);

    // Clear selections before the mode changes so the all-enabled trigger holds.
    if (values.selectionMode === "all_enabled") replaceSourceSelections(tx, current, []);
    const updated = tx
      .update(initiatives)
      .set({ name: values.name, objective: values.objective, selectionMode: values.selectionMode, lockVersion: current.lockVersion + 1, updatedAt: new Date() })
      .where(and(eq(initiatives.id, current.id), eq(initiatives.lockVersion, current.lockVersion)))
      .returning()
      .get();
    if (!updated) throw new StaleRecordError(`${current.name} was changed by someone else`);
    if (values.selectionMode === "explicit") replaceSourceSelections(tx, updated, selections.sources);
    replaceReleaseSelections(tx, updated, selections.releases);
    return updated;
  });
}

/**
 * Replaces only the Releases an initiative selects. The Salt Patterns
 * initiative is changed this way alone: it has no sources to select, and its
 * name, objective, and scope are fixed (initiative-scoping spec).
 */
export function updateReleaseSelections(db: Executor, publicId: string, expectedLockVersion: number, standardReleasePublicIds: readonly string[]): Initiative {
  return immediate(db, (tx) => {
    const current = getInitiative(tx, publicId);
    if (current.profiling) throw new ValidationError([{ field: "base", message: PROFILING_FIXED }]);
    if (current.lockVersion !== expectedLockVersion) throw new StaleRecordError(`${current.name} was changed by someone else`);
    // Validated as a scope that selects no sources, so only the Releases are checked.
    const { releases } = validate(tx, normalize({ name: current.name, objective: current.objective, selectionMode: "all_enabled", standardReleasePublicIds }), new Set());
    const updated = tx
      .update(initiatives)
      .set({ lockVersion: current.lockVersion + 1, updatedAt: new Date() })
      .where(and(eq(initiatives.id, current.id), eq(initiatives.lockVersion, current.lockVersion)))
      .returning()
      .get();
    if (!updated) throw new StaleRecordError(`${current.name} was changed by someone else`);
    replaceReleaseSelections(tx, updated, releases);
    return updated;
  });
}

/** Deletes an initiative that has never been assessed. */
export function deleteInitiative(db: Executor, publicId: string): void {
  immediate(db, (tx) => {
    const initiative = getInitiative(tx, publicId);
    if (initiative.systemOwned || initiative.profiling) throw new ValidationError([{ field: "base", message: `${initiative.name} is owned by DE FabLab and is retained` }]);
    if (isSystemOwned(initiative)) throw new ValidationError([{ field: "base", message: `${initiative.name} was created for a claimed Repository and is retained` }]);
    const assessed = tx.select({ id: assessments.id }).from(assessments).where(eq(assessments.initiativeId, initiative.id)).limit(1).get();
    if (assessed) {
      throw new ValidationError([{ field: "base", message: `${initiative.name} has Runs and is retained so their history stays reviewable` }]);
    }
    tx.delete(initiatives).where(eq(initiatives.id, initiative.id)).run();
  });
}

export function findInitiative(db: Executor, publicId: string): Initiative | undefined {
  return db.select().from(initiatives).where(eq(initiatives.publicId, publicId)).get();
}

export function getInitiative(db: Executor, publicId: string): Initiative {
  const initiative = findInitiative(db, publicId);
  if (!initiative) throw new NotFoundError(`Initiative ${publicId} does not exist`);
  return initiative;
}

export function initiativeById(db: Executor, id: number): Initiative {
  const initiative = db.select().from(initiatives).where(eq(initiatives.id, id)).get();
  if (!initiative) throw new NotFoundError(`Initiative ${id} does not exist`);
  return initiative;
}

/**
 * Initiatives operators created, or with +systemOwned+, those the system
 * created for claims. Neither includes the Salt Patterns or Repository
 * profiling initiative.
 */
export function listInitiatives(db: Executor, options: { systemOwned?: boolean } = {}): Initiative[] {
  const owner = and(options.systemOwned ? isNotNull(initiatives.claimRepositorySourceId) : isNull(initiatives.claimRepositorySourceId), not(initiatives.systemOwned), not(initiatives.profiling));
  return db.select().from(initiatives).where(owner).orderBy(sql`lower(${initiatives.name})`, asc(initiatives.publicId)).all();
}

/** The explicit selections of an initiative, in catalog order. */
export function selectedSources(db: Executor, initiativeId: number): RepositorySource[] {
  return db
    .select({ source: repositorySources })
    .from(initiativeTargets)
    .innerJoin(repositorySources, eq(repositorySources.id, initiativeTargets.repositorySourceId))
    .where(eq(initiativeTargets.initiativeId, initiativeId))
    .orderBy(sql`lower(${repositorySources.name})`, asc(repositorySources.publicId))
    .all()
    .map((row) => row.source);
}

/** The Releases an initiative currently selects, by Standard name then version. */
export function selectedReleases(db: Executor, initiativeId: number): { release: StandardRelease; standard: Standard }[] {
  return db
    .select({ release: standardReleases, standard: standards })
    .from(initiativeStandardReleases)
    .innerJoin(standardReleases, eq(standardReleases.id, initiativeStandardReleases.standardReleaseId))
    .innerJoin(standards, eq(standards.id, standardReleases.standardId))
    .where(eq(initiativeStandardReleases.initiativeId, initiativeId))
    .orderBy(sql`lower(${standards.name})`, asc(standardReleases.version))
    .all();
}

export function scopeLabel(initiative: Initiative, selectedCount: number): string {
  if (initiative.selectionMode === "all_enabled") return "All enabled Repositories";
  return `${selectedCount} selected ${selectedCount === 1 ? "Repository" : "Repositories"}`;
}

function normalize(input: InitiativeInput): Required<InitiativeInput> {
  const ids = (values: readonly string[] | undefined) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
  return {
    name: input.name.replace(/\s+/g, " ").trim(),
    objective: (input.objective ?? "").trim(),
    selectionMode: input.selectionMode,
    sourcePublicIds: ids(input.sourcePublicIds),
    standardReleasePublicIds: ids(input.standardReleasePublicIds),
  };
}

function validate(db: Executor, input: Required<InitiativeInput>, previouslySelected: ReadonlySet<number>): Selections {
  const issues = new IssueCollector();
  if (!input.name) issues.add("name", "Enter a name");
  else if (input.name.length > 120) issues.add("name", "Name must be 120 characters or fewer");
  if (input.objective.length > 2000) issues.add("objective", "Objective must be 2,000 characters or fewer");
  if (!SELECTION_MODES.includes(input.selectionMode)) issues.add("selectionMode", "Choose all enabled sources or selected sources");

  let sources: RepositorySource[] = [];
  if (input.selectionMode === "explicit") {
    const ids = input.sourcePublicIds;
    const found = ids.length ? db.select().from(repositorySources).where(inArray(repositorySources.publicId, [...ids])).all() : [];
    const byPublicId = new Map(found.map((source) => [source.publicId, source]));
    for (const publicId of ids) {
      const source = byPublicId.get(publicId);
      if (!source) issues.add("sources", `Repository source ${publicId} does not exist`);
      else if (!source.enabled && !previouslySelected.has(source.id)) issues.add("sources", `${source.name} is disabled and cannot be selected`);
    }
    if (ids.length === 0) issues.add("sources", "Select at least one repository source for an explicit scope");
    sources = ids.flatMap((publicId) => byPublicId.get(publicId) ?? []);
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
  return { sources, releases: releaseIds.flatMap((publicId) => releasesByPublicId.get(publicId) ?? []) };
}

function replaceSourceSelections(db: Executor, initiative: Initiative, sources: readonly RepositorySource[]): void {
  const wanted = new Set(sources.map((source) => source.id));
  const existing = db.select().from(initiativeTargets).where(eq(initiativeTargets.initiativeId, initiative.id)).all();
  const existingIds = new Set(existing.map((target) => target.repositorySourceId));

  const removed = existing.filter((target) => !wanted.has(target.repositorySourceId)).map((target) => target.id);
  if (removed.length) db.delete(initiativeTargets).where(inArray(initiativeTargets.id, removed)).run();

  const added = sources.filter((source) => !existingIds.has(source.id));
  const now = new Date();
  if (added.length) {
    db.insert(initiativeTargets)
      .values(added.map((source) => ({ initiativeId: initiative.id, repositorySourceId: source.id, createdAt: now })))
      .run();
  }
}

function replaceReleaseSelections(db: Executor, initiative: Initiative, releases: readonly StandardRelease[]): void {
  const wanted = new Set(releases.map((release) => release.id));
  const existing = db.select().from(initiativeStandardReleases).where(eq(initiativeStandardReleases.initiativeId, initiative.id)).all();
  const existingIds = new Set(existing.map((selection) => selection.standardReleaseId));

  const removed = existing.filter((selection) => !wanted.has(selection.standardReleaseId)).map((selection) => selection.id);
  if (removed.length) db.delete(initiativeStandardReleases).where(inArray(initiativeStandardReleases.id, removed)).run();

  const added = releases.filter((release) => !existingIds.has(release.id));
  const now = new Date();
  if (added.length) {
    db.insert(initiativeStandardReleases)
      .values(added.map((release) => ({ initiativeId: initiative.id, standardReleaseId: release.id, createdAt: now })))
      .run();
  }
}
