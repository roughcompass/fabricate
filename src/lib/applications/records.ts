import { and, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { JsonObject } from "@repo-facts/contract";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, NotFoundError, StaleRecordError, isUniqueViolation } from "@/lib/db/errors";
import { redactSecrets } from "@/lib/git/redact";
import { type ApplicationOutcome, type AttemptState, RESERVED_SLUGS, type ScreenshotState, applications, previewBuilds, previewScreenshots, repositories } from "@/lib/db/schema";
import { updateLocked } from "@/lib/db/optimistic";
import { pageQuery } from "@/lib/web/query";
import { type ApplicationImage, type ApplicationStatus, STATUS_FILTERS, type StatusFilter, applicationImage, applicationStatus, isSettling, statusFilter } from "./status";

/**
 * Persistence for applications (add-applications, design decision 1): the
 * rows, as pages and the status endpoint read them, with their status and
 * image derived from the current build and the latest attempt, and the
 * changes that need no build: renaming and deleting. Builds go through
 * pipeline.ts.
 */

export type ApplicationRow = typeof applications.$inferSelect;

/** Why the latest attempt failed or was refused. */
export interface ApplicationReason {
  /** The reason as a sentence. */
  readonly text: string;
  /** The eligibility condition that failed, when the commit was refused, or its build emitted no page. */
  readonly condition?: string;
  /** The last meaningful lines of a failed build's log, redacted, when it ran far enough to write any. */
  readonly log?: readonly string[];
}

/** Stored reasons as pages show them: redacted again as they're read, so reasons recorded before a credential's form was recognized show none either. */
export function shownReasons(stored: unknown): ApplicationReason[] {
  return ((stored ?? []) as ApplicationReason[]).map((reason) => ({ ...reason, text: redactSecrets(reason.text), ...(reason.log && { log: reason.log.map(redactSecrets) }) }));
}

/** What the package is built with, from its latest decided verdict. */
export interface ApplicationFacts {
  readonly frameworks: readonly string[];
  readonly buildTool: string | null;
  readonly packageManager: string | null;
}

/** A build an application points at. */
export interface ApplicationBuild {
  /** The preview's public ID: its files are served under /previews/<id>/. */
  readonly preview: string;
  readonly commitSha: string;
  readonly attempt: number;
  readonly attemptState: AttemptState;
  /** When its latest attempt finished. */
  readonly finishedAt: Date | null;
  /** Set once an attempt published, for the current build always. */
  readonly nodeVersion: string | null;
  readonly packageManager: string | null;
}

/** An application as pages, the status endpoint, and the toolbar show it. */
export interface Application {
  readonly publicId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly repository: { readonly publicId: string; readonly name: string };
  readonly packageDir: string;
  /** The tracked branch, qualified (refs/heads/main), and as it's shown (main). */
  readonly trackedRef: string;
  readonly trackedBranch: string;
  readonly status: ApplicationStatus;
  readonly image: ApplicationImage;
  /** Whether a build or a screenshot is under way, so a page keeps refreshing. */
  readonly settling: boolean;
  readonly latest: {
    readonly outcome: ApplicationOutcome;
    readonly commitSha: string;
    readonly requestedAt: Date;
    readonly reasons: readonly ApplicationReason[];
    /** The latest attempt's build, once its commit's preparation started one. */
    readonly build: ApplicationBuild | null;
  };
  /** The current build: the last that succeeded. */
  readonly current: ApplicationBuild | null;
  /** The current build's screenshot, when it's ready: a version for its address, and when it was captured. */
  readonly screenshot: { readonly version: string; readonly capturedAt: Date } | null;
  readonly facts: ApplicationFacts;
  readonly lockVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const NAME_LIMIT = 80;
const DESCRIPTION_LIMIT = 280;
const SLUG_LIMIT = 60;

// -- Reading ----------------------------------------------------------------------

const currentBuild = alias(previewBuilds, "current_build");
const latestBuild = alias(previewBuilds, "latest_build");

const buildColumns = <T extends typeof currentBuild | typeof latestBuild>(table: T) => ({
  preview: table.publicId,
  commitSha: table.commitSha,
  attempt: table.attempt,
  attemptState: table.attemptState,
  finishedAt: table.finishedAt,
  nodeVersion: table.nodeVersion,
  packageManager: table.packageManager,
});

function selectApplications(db: Executor) {
  return db
    .select({
      row: applications,
      repository: { publicId: repositories.publicId, name: repositories.name },
      current: buildColumns(currentBuild),
      latest: buildColumns(latestBuild),
      screenshot: { state: previewScreenshots.state, capturedAt: previewScreenshots.capturedAt },
    })
    .from(applications)
    .innerJoin(repositories, eq(repositories.id, applications.repositoryId))
    .leftJoin(currentBuild, eq(currentBuild.id, applications.currentPreviewId))
    .leftJoin(latestBuild, eq(latestBuild.id, applications.latestPreviewId))
    .leftJoin(previewScreenshots, eq(previewScreenshots.previewId, applications.currentPreviewId));
}

type Selected = Awaited<ReturnType<ReturnType<typeof selectApplications>["all"]>>[number];

function toApplication({ row, repository, current, latest, screenshot }: Selected): Application {
  // A left join with no row gives null.
  const build = (value: Selected["current"] | Selected["latest"]): ApplicationBuild | null => (value === null || value.preview === null ? null : (value as ApplicationBuild));
  const screenshotState = (screenshot?.state ?? null) as ScreenshotState | null;
  const input = { latestOutcome: row.latestOutcome, hasCurrent: row.currentPreviewId !== null, screenshot: screenshotState };
  const facts = (row.latestFacts ?? {}) as Partial<ApplicationFacts>;
  return {
    publicId: row.publicId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    repository,
    packageDir: row.packageDir,
    trackedRef: row.trackedRef,
    trackedBranch: branchLabel(row.trackedRef),
    status: applicationStatus(input),
    image: applicationImage(input),
    settling: isSettling(input),
    latest: { outcome: row.latestOutcome, commitSha: row.latestCommitSha, requestedAt: row.latestRequestedAt, reasons: shownReasons(row.latestReasons), build: build(latest) },
    current: build(current),
    screenshot: screenshotState === "ready" && screenshot?.capturedAt ? { version: screenshot.capturedAt.getTime().toString(36), capturedAt: screenshot.capturedAt } : null,
    facts: { frameworks: facts.frameworks ?? [], buildTool: facts.buildTool ?? null, packageManager: facts.packageManager ?? null },
    lockVersion: row.lockVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The application at /applications/<slug>, or undefined. */
export function findApplication(db: Executor, slug: string): Application | undefined {
  const selected = selectApplications(db).where(eq(applications.slug, slug)).get();
  return selected && toApplication(selected);
}

/**
 * The application at /applications/<slug>, or a NotFoundError.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function getApplication(db: Executor, slug: string): Application {
  const application = findApplication(db, slug);
  if (!application) throw new NotFoundError(`Unknown application ${slug}`);
  return application;
}

/** Every application, by name. Few enough to read whole: one per Repository package an operator onboarded. */
export function allApplications(db: Executor): Application[] {
  return selectApplications(db)
    .all()
    .map(toApplication)
    .sort((a, b) => compareNames(a.name, b.name));
}

/** The applications with these public IDs, for the status endpoint; unknown IDs are left out. */
export function applicationsByPublicId(db: Executor, publicIds: readonly string[]): Application[] {
  if (publicIds.length === 0) return [];
  return selectApplications(db)
    .where(inArray(applications.publicId, [...publicIds]))
    .all()
    .map(toApplication);
}

/**
 * What a page that shows +shown+ polls for: a version that changes whenever
 * one's status, image, or screenshot does, and each one's state, so a page
 * can refresh and announce a finished build (catalog spec, "Applications
 * update while builds run").
 */
export function statusSnapshot(shown: readonly Application[]): { version: string; settling: boolean; applications: { id: string; name: string; status: ApplicationStatus; image: ApplicationImage; settling: boolean }[] } {
  const items = shown.map((application) => ({ id: application.publicId, name: application.name, status: application.status, image: application.image, settling: application.settling }));
  const version = shown.map((application) => `${application.publicId}:${application.status}:${application.image}:${application.screenshot?.version ?? ""}:${application.latest.build?.attempt ?? 0}`).join("|");
  return { version, settling: items.some((item) => item.settling), applications: items };
}

/** The application built from a Repository's package, if it is one. */
export function applicationOfPackage(db: Executor, repositoryId: number, packageDir: string): Application | undefined {
  const selected = selectApplications(db)
    .where(and(eq(applications.repositoryId, repositoryId), eq(applications.packageDir, packageDir)))
    .get();
  return selected && toApplication(selected);
}

export function findApplicationRow(db: Executor, publicId: string): ApplicationRow | undefined {
  return db.select().from(applications).where(eq(applications.publicId, publicId)).get();
}

export function getApplicationRow(db: Executor, publicId: string): ApplicationRow {
  const row = findApplicationRow(db, publicId);
  if (!row) throw new NotFoundError(`Unknown application ${publicId}`);
  return row;
}

// -- Listing ----------------------------------------------------------------------

/*
 * Search, filters, and pages for the Applications page (applications/catalog
 * spec; design decision 9). Search matches an application's name,
 * description, repository name, and tracked branch, ignoring case. Options
 * within a filter group combine with OR; groups and the search combine with
 * AND. Applications are ordered by name, 24 to a page. The query lives in
 * the address: `q`, `framework` and `status` once per option, and `page`.
 *
 * Applications are few enough to filter in memory, one per onboarded
 * Repository package, so the options' counts are exact for every query.
 */

export const PAGE_SIZE = 24;
const SEARCH_LIMIT = 100;

export interface ApplicationQuery {
  readonly search: string;
  readonly frameworks: readonly string[];
  readonly statuses: readonly StatusFilter[];
  readonly page: number;
}

export const EMPTY_QUERY: ApplicationQuery = { search: "", frameworks: [], statuses: [], page: 1 };

type Params = Readonly<Record<string, string | string[] | undefined>>;

const values = (params: Params, name: string) => [params[name]].flat().filter((value): value is string => typeof value === "string");

/**
 * Reads the query from the address, ignoring unknown statuses and a page that isn't a positive number.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function parseApplicationQuery(params: Params): ApplicationQuery {
  const search = (values(params, "q")[0] ?? "").trim().replace(/\s+/g, " ").slice(0, SEARCH_LIMIT);
  const frameworks = [...new Set(values(params, "framework").map((value) => value.trim()).filter((value) => value !== "" && value.length <= 40))];
  const statuses = STATUS_FILTERS.filter((status) => values(params, "status").includes(status));
  const page = Number.parseInt(values(params, "page")[0] ?? "1", 10);
  return { search, frameworks, statuses, page: Number.isSafeInteger(page) && page > 0 ? page : 1 };
}

/**
 * The Applications page's address for +query+; changing the search or filters returns to the first page.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function applicationsHref(query: ApplicationQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  for (const framework of query.frameworks) params.append("framework", framework);
  for (const status of query.statuses) params.append("status", status);
  const page = pageQuery(query.page);
  if (page !== null) params.set("page", String(page));
  return `/applications${params.size ? `?${params}` : ""}`;
}

export interface FilterOption<T extends string = string> {
  readonly value: T;
  /** How many applications it would match with the search and the other group's filters. */
  readonly count: number;
}

export interface ApplicationListing {
  /** This page's applications. */
  readonly items: readonly Application[];
  /** How many match the query, and how many exist. */
  readonly matched: number;
  readonly total: number;
  /** The page shown, after clamping to the last page, and how many pages there are. */
  readonly page: number;
  readonly pages: number;
  /** The first and last positions shown, from 1, for "Showing 1–24 of 60 applications"; 0 and 0 when none match. */
  readonly from: number;
  readonly to: number;
  readonly frameworks: readonly FilterOption[];
  readonly statuses: readonly FilterOption<StatusFilter>[];
}

/**
 * The applications +query+ matches, a page of them, and each filter option's count.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function listApplications(db: Executor, query: ApplicationQuery = EMPTY_QUERY): ApplicationListing {
  return listOf(allApplications(db), query);
}

/** As listApplications, over +all+, ordered by name. */
function listOf(all: readonly Application[], query: ApplicationQuery): ApplicationListing {
  const matched = all.filter((application) => matches(application, query));
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const start = (page - 1) * PAGE_SIZE;
  const items = matched.slice(start, start + PAGE_SIZE);
  const frameworkNames = [...new Set(all.flatMap((application) => application.facts.frameworks))].sort((a, b) => a.localeCompare(b, "en"));
  return {
    items,
    matched: matched.length,
    total: all.length,
    page,
    pages,
    from: items.length ? start + 1 : 0,
    to: start + items.length,
    // Every framework an application declares, and the selected ones even when none does any longer.
    frameworks: [...new Set([...frameworkNames, ...query.frameworks])].map((value) => ({ value, count: all.filter((application) => application.facts.frameworks.includes(value) && matches(application, query, "framework")).length })),
    statuses: STATUS_FILTERS.map((value) => ({ value, count: all.filter((application) => statusFilter(application.status) === value && matches(application, query, "status")).length })),
  };
}

/** Whether +application+ matches +query+, leaving out the group +ignore+, for its options' counts. */
function matches(application: Application, query: ApplicationQuery, ignore?: "framework" | "status"): boolean {
  return (
    matchesSearch(application, query.search) &&
    (ignore === "framework" || query.frameworks.length === 0 || query.frameworks.some((framework) => application.facts.frameworks.includes(framework))) &&
    (ignore === "status" || query.statuses.length === 0 || query.statuses.includes(statusFilter(application.status)))
  );
}

function matchesSearch(application: Application, search: string): boolean {
  if (!search) return true;
  const term = search.toLowerCase();
  return [application.name, application.description, application.repository.name, application.trackedBranch].some((text) => text.toLowerCase().includes(term));
}

// -- Names ------------------------------------------------------------------------

/** A name as uniqueness compares it: trimmed, normalized, and lowercased. */
export function nameKey(name: string): string {
  return name.trim().normalize("NFKC").toLowerCase();
}

/** The name and description as stored: trimmed, with runs of whitespace in the name made one space. */
export function normalizeDetails(details: { name: string; description: string }): { name: string; description: string } {
  return { name: details.name.trim().replace(/\s+/g, " "), description: details.description.trim() };
}

/** Collects what's wrong with a name and description (applications/onboarding spec, "The application is named and described"). */
export function checkDetails(db: Executor, details: { name: string; description: string }, issues: IssueCollector, except?: number): void {
  const { name, description } = normalizeDetails(details);
  if (name.length === 0) issues.add("name", "Enter a name");
  else if ([...name].length > NAME_LIMIT) issues.add("name", `Use at most ${NAME_LIMIT} characters`);
  else {
    const taken = db.select({ id: applications.id, name: applications.name }).from(applications).where(eq(applications.nameKey, nameKey(name))).get();
    if (taken && taken.id !== except) issues.add("name", `${taken.name} is already the name of an application. Choose another name.`);
  }
  if ([...description].length > DESCRIPTION_LIMIT) issues.add("description", `Use at most ${DESCRIPTION_LIMIT} characters`);
}

/**
 * A free slug for a new application named +name+: its words lowercased and
 * joined by hyphens, accents removed, at most 60 characters, and a number
 * added when another application has it. It never changes afterward.
 */
export function slugFor(db: Executor, name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let base = words.slice(0, SLUG_LIMIT).replace(/-+$/, "") || "application";
  if ((RESERVED_SLUGS as readonly string[]).includes(base)) base = `${base}-application`;
  const taken = new Set(
    db
      .select({ slug: applications.slug })
      .from(applications)
      .all()
      .map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// -- Changing ---------------------------------------------------------------------

/**
 * Renames an application and changes its description, keeping its address.
 * Throws ValidationError for a missing, long, or taken name, and
 * StaleRecordError when it changed since +expectedLockVersion+.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function updateApplicationDetails(db: Executor, publicId: string, expectedLockVersion: number, details: { name: string; description: string }): ApplicationRow {
  return immediate(db, (tx) => {
    const current = getApplicationRow(tx, publicId);
    if (current.lockVersion !== expectedLockVersion) throw new StaleRecordError(`${current.name} was changed by someone else`);
    const issues = new IssueCollector();
    checkDetails(tx, details, issues, current.id);
    issues.throwIfAny();
    const { name, description } = normalizeDetails(details);
    try {
      return updateLocked(tx, applications, current, { name, nameKey: nameKey(name), description, updatedAt: new Date() }, `${current.name} was changed by someone else`);
    } catch (error) {
      if (isUniqueViolation(error)) {
        issues.add("name", `${name} is already the name of an application. Choose another name.`);
        issues.throwIfAny();
      }
      throw error;
    }
  });
}

/**
 * Deletes an application. Its builds stay as the Repository's previews, and
 * are pruned like any other once no application uses them. Returns false
 * when there was no such application.
 * @public The Applications pages and their actions use this (add-applications tasks 5 to 8).
 */
export function deleteApplication(db: Executor, publicId: string): boolean {
  return db.delete(applications).where(eq(applications.publicId, publicId)).run().changes === 1;
}

/** Deletes the applications built from the Repository with row id +repositoryId+, in the caller's transaction, which deletes the Repository. */
export function deleteRepositoryApplications(db: Executor, repositoryId: number): number {
  return db.delete(applications).where(eq(applications.repositoryId, repositoryId)).run().changes;
}

/** Updates the latest attempt's outcome of the applications +where+ selects. */
export function settleApplications(db: Executor, where: ReturnType<typeof and>, values: { outcome: ApplicationOutcome; reasons?: readonly ApplicationReason[] | null; current?: number; latestPreview?: number; facts?: ApplicationFacts }): number {
  const now = new Date();
  return db
    .update(applications)
    .set({
      latestOutcome: values.outcome,
      latestReasons: values.reasons && values.reasons.length > 0 ? (values.reasons as unknown as JsonObject[]) : null,
      ...(values.current !== undefined && { currentPreviewId: values.current }),
      ...(values.latestPreview !== undefined && { latestPreviewId: values.latestPreview }),
      ...(values.facts !== undefined && { latestFacts: values.facts as unknown as JsonObject }),
      updatedAt: now,
    })
    .where(where)
    .run().changes;
}

/** Applications whose latest attempt is waiting on the preparation with row id +preparationId+ to start a build. */
export function waitingOnPreparation(preparationId: number) {
  return and(eq(applications.latestPreparationId, preparationId), eq(applications.latestOutcome, "building"), isNull(applications.latestPreviewId));
}

// -- Helpers ----------------------------------------------------------------------

/** A tracked ref as it's shown: refs/heads/main is main. */
export function branchLabel(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
}
