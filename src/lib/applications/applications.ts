import { and, desc, eq, sql } from "drizzle-orm";
import { resolveCloneUrl } from "@/lib/catalog/catalog";
import { BoundaryViolation, SourceBoundary } from "@/lib/catalog/source-boundary";
import { type RepositorySource, findEnabledSourceByCanonicalUrl, insertSource, setSourceEnabled } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { type Issue, NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import { applications, onboardingEvents, portals, repositorySources } from "@/lib/db/schema";
import { type Actor, recordEvent } from "@/lib/onboarding/attribution";
import { onboardedPortal } from "@/lib/onboarding/catalog";
import { SEAL_ID } from "@/lib/ownership/records";
import { repositoryName } from "@/lib/ownership/claims";
import { RepositoryUrlError, parseRepositoryUrl } from "./repository-url";
import { deriveApplicationSlug, slugProblem } from "./slug";

/*
 * Applications registered through Create Application (applications and
 * application-creation specs; design decision 6). An Application has a SEAL
 * ID, a name, a slug, a description, one repository in the registry, one
 * Portal, and the starter it began from. Creating one registers its
 * repository, or reuses or re-enables the one the registry has, in a single
 * transaction; the DE Web assessment starts after (assessment.ts). Nothing is
 * written to Bitbucket or GitHub, and no request leaves Fabricate.
 */

export type Application = typeof applications.$inferSelect;

export const MAX_APPLICATION_NAME = 100;
export const MAX_APPLICATION_DESCRIPTION = 500;

/** An issue that names a record the operator can open, such as the Application that already uses a repository. */
export interface LinkedIssue extends Issue {
  link?: { href: string; label: string };
}

/** Field problems with a submitted Application, some linking to the record they name. */
export class ApplicationValidationError extends ValidationError {
  override name = "ApplicationValidationError";

  constructor(override readonly issues: readonly LinkedIssue[]) {
    super(issues);
  }
}

export function findApplication(db: Executor, publicId: string): Application | undefined {
  return db.select().from(applications).where(eq(applications.publicId, publicId)).get();
}

export function getApplication(db: Executor, publicId: string): Application {
  const application = findApplication(db, publicId);
  if (!application) throw new NotFoundError(`Application ${publicId} doesn't exist`);
  return application;
}

/** An Application's dashboard. */
export const applicationHref = (publicId: string) => `/applications/${publicId}`;

export interface ApplicationDetails {
  sealId: string;
  name: string;
  description: string;
}

export interface ApplicationInput extends ApplicationDetails {
  /** Derived from the name when blank. */
  slug?: string | null;
  repositoryUrl: string;
  /** The public ID of an onboarded Portal. */
  portal: string;
  /** The starter or template slug it's created from, if any. */
  starter?: string | null;
}

function checkDetails(input: ApplicationDetails, issues: LinkedIssue[]) {
  const sealId = input.sealId?.trim() || "";
  if (!sealId) issues.push({ field: "sealId", message: "Enter the application's SEAL ID" });
  else if (!SEAL_ID.test(sealId)) issues.push({ field: "sealId", message: "Enter a SEAL ID of letters, digits, dots, dashes, or underscores" });
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) issues.push({ field: "name", message: "Enter the application's name" });
  else if (name.length > MAX_APPLICATION_NAME) issues.push({ field: "name", message: `Use ${MAX_APPLICATION_NAME} characters or fewer` });
  const description = input.description?.trim() || "";
  if (!description) issues.push({ field: "description", message: "Enter a description of the application" });
  else if (description.length > MAX_APPLICATION_DESCRIPTION) issues.push({ field: "description", message: `Use ${MAX_APPLICATION_DESCRIPTION} characters or fewer` });
  return { sealId, name, description };
}

/**
 * The registry's Repository for +cloneUrl+: the enabled one with its
 * canonical URL, a disabled one re-enabled, or a new one. One another
 * Application already uses is refused, naming and linking that Application.
 */
function repositoryFor(tx: Executor, resolved: { cloneUrl: string; canonicalUrl: string }, issues: LinkedIssue[]): RepositorySource | (() => RepositorySource) | null {
  const existing =
    findEnabledSourceByCanonicalUrl(tx, resolved.canonicalUrl) ??
    tx.select().from(repositorySources).where(eq(repositorySources.canonicalUrl, resolved.canonicalUrl)).orderBy(desc(repositorySources.id)).get();
  if (existing) {
    const owner = tx.select({ publicId: applications.publicId, name: applications.name }).from(applications).where(eq(applications.repositorySourceId, existing.id)).get();
    if (owner) {
      issues.push({ field: "repositoryUrl", message: `${owner.name ?? owner.publicId} already uses this repository`, link: { href: applicationHref(owner.publicId), label: `Open ${owner.name ?? owner.publicId}` } });
      return null;
    }
    // Writes wait until every field is valid, so a refused submission changes nothing.
    return existing.enabled ? existing : () => setSourceEnabled(tx, existing.publicId, true);
  }
  return () => insertSource(tx, { name: repositoryName(resolved.canonicalUrl), ...resolved });
}

/**
 * Creates an Application in a Portal, registering its repository, attributed
 * to +actor+ and marked Unverified (application-creation spec). Every field
 * is required except the starter; every problem is reported at its field.
 */
export function createApplication(db: Executor, input: ApplicationInput, actor: Actor, config: FabricateConfig = getConfig()): Application {
  return immediate(db, (tx) => {
    const issues: LinkedIssue[] = [];
    const { sealId, name, description } = checkDetails(input, issues);

    const slug = input.slug?.trim() || deriveApplicationSlug(name);
    const problem = name || input.slug?.trim() ? slugProblem(slug) : null;
    if (problem) issues.push({ field: "slug", message: problem });
    else if (slug) {
      const holder = tx.select({ publicId: applications.publicId, name: applications.name }).from(applications).where(eq(applications.slug, slug)).get();
      if (holder) issues.push({ field: "slug", message: `The slug ${slug} belongs to ${holder.name ?? holder.publicId}`, link: { href: applicationHref(holder.publicId), label: `Open ${holder.name ?? holder.publicId}` } });
    }

    const starter = input.starter?.trim() || null;
    if (starter && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(starter)) issues.push({ field: "starter", message: "Choose a starter from the catalog" });

    const portal = input.portal ? tx.select().from(portals).where(and(eq(portals.publicId, input.portal), onboardedPortal(tx))).get() : undefined;
    if (!portal) issues.push({ field: "portal", message: "Choose the Portal the application belongs to" });

    let repository: ReturnType<typeof repositoryFor> = null;
    try {
      const parsed = parseRepositoryUrl(input.repositoryUrl ?? "", { bitbucketHosts: config.applications.bitbucketHosts, allowLocal: true });
      repository = repositoryFor(tx, resolveCloneUrl(parsed.cloneUrl, new SourceBoundary(config)), issues);
    } catch (error) {
      if (!(error instanceof RepositoryUrlError || error instanceof BoundaryViolation)) throw error;
      issues.push({ field: "repositoryUrl", message: error.message });
    }
    if (issues.length) throw new ApplicationValidationError(issues);

    const source = typeof repository === "function" ? repository() : repository!;
    const now = new Date();
    const application = tx
      .insert(applications)
      .values({ publicId: generatePublicId("wap"), sealId, name, slug, description, starter, repositorySourceId: source.id, portalId: portal!.id, createdBy: actor.name, verification: "unverified", createdAt: now, updatedAt: now })
      .returning()
      .get();
    recordEvent(tx, "application", application.id, { event: "created", actor, at: now, detail: starter ? `Created from ${starter}` : null });
    return application;
  });
}

/**
 * Changes an Application's name, SEAL ID, and description in place. Its
 * slug, repository, and Portal are fixed. A save based on an older version
 * is refused (reviews spec, "Stale edits are refused rather than
 * overwritten"); one that changes nothing records nothing.
 */
export function editApplicationDetails(db: Executor, publicId: string, input: ApplicationDetails & { lockVersion: number }, actor: Actor): Application {
  return immediate(db, (tx) => {
    const application = getApplication(tx, publicId);
    if (application.lockVersion !== input.lockVersion) throw new StaleRecordError(`${application.name ?? application.publicId} changed since you opened it`);
    const issues: LinkedIssue[] = [];
    const next = checkDetails(input, issues);
    if (issues.length) throw new ApplicationValidationError(issues);
    const labels = { name: "name", sealId: "SEAL ID", description: "description" } as const;
    const changed = (Object.keys(labels) as (keyof typeof labels)[]).filter((key) => next[key] !== application[key]);
    if (changed.length === 0) return application;
    const updated = tx
      .update(applications)
      .set({ ...next, updatedAt: new Date(), lockVersion: sql`${applications.lockVersion} + 1` })
      .where(eq(applications.id, application.id))
      .returning()
      .get();
    const list = changed.map((key) => labels[key]);
    recordEvent(tx, "application", application.id, { event: "details_changed", actor, detail: `Changed the ${list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`}` });
    return updated;
  });
}

/** The Application's history, newest first. */
export function applicationHistory(db: Executor, applicationId: number) {
  return db.select().from(onboardingEvents).where(eq(onboardingEvents.applicationId, applicationId)).orderBy(desc(onboardingEvents.occurredAt), desc(onboardingEvents.id)).all();
}
