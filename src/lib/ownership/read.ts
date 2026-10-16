import { and, eq, inArray, or } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { assessmentTargets, linesOfBusiness, ownershipAssertions, ownershipSupersessions, portals, repositorySources, applications } from "@/lib/db/schema";
import { UNKNOWN, type Effective, type Provenance, asOfLatest, effectivePortals, effectiveValue } from "./effective";
import type { OwnershipAssertion } from "./records";

/*
 * Current effective ownership, read in a handful of queries for any number of
 * repositories, so a page over a 500-repository Run reads it once. Ownership
 * isn't bound to an Assessment: every reader gets today's values and the time
 * they were last stated.
 */

export interface ApplicationRef {
  id: number;
  publicId: string;
  sealId: string | null;
  name: string | null;
}

export interface LabelRef {
  id: number;
  publicId: string;
  label: string;
  /** The approved ontology concept, or null while the value is pending review. */
  conceptKey: string | null;
}

export interface RepositoryRef {
  id: number;
  publicId: string;
  name: string;
}

export interface PortalInApplication {
  portal: LabelRef;
  provenance: Provenance;
  flagged: boolean;
}

export interface ApplicationOwnership {
  application: ApplicationRef;
  team: Effective<string>;
  lineOfBusiness: Effective<LabelRef>;
  portals: PortalInApplication[];
  /** True when the DE Console lists the application: its values are the source of record. */
  deWeb: boolean;
  asOf: Date | null;
}

export interface RepositoryOwnership {
  repository: RepositoryRef;
  application: Effective<ApplicationRef>;
  team: Effective<string>;
  lineOfBusiness: Effective<LabelRef>;
  /** The portals the repository appears in: its application's portals. */
  portals: PortalInApplication[];
  /** The portals whose effective host is this repository. */
  hosts: LabelRef[];
  deWeb: boolean;
  asOf: Date | null;
}

export interface PortalOwnership {
  portal: LabelRef;
  owner: Effective<ApplicationRef>;
  host: Effective<RepositoryRef>;
  /** The owner's Line of Business. */
  lineOfBusiness: Effective<LabelRef>;
  asOf: Date | null;
}

export function applicationOwnership(db: Executor, applicationIds: readonly number[]): Map<number, ApplicationOwnership> {
  const ids = [...new Set(applicationIds)];
  if (ids.length === 0) return new Map();
  const applications = refsOf(db, "application", ids);
  const assertions = db.select().from(ownershipAssertions).where(inArray(ownershipAssertions.subjectApplicationId, ids)).all();
  const superseded = supersededAmong(db, assertions);
  const lines = labelsOf(db, "lineOfBusiness", assertions.map((assertion) => assertion.valueLineOfBusinessId));
  const portalRefs = labelsOf(db, "portal", assertions.map((assertion) => assertion.valuePortalId));

  const result = new Map<number, ApplicationOwnership>();
  for (const id of ids) {
    const application = applications.get(id);
    if (!application) continue;
    const mine = assertions.filter((assertion) => assertion.subjectApplicationId === id);
    const deWeb = mine.some((assertion) => assertion.source === "de_console" && !superseded.has(assertion.id));
    const team = effectiveValue(of(mine, "team"), superseded, (assertion) => assertion.valueTeam!, (assertion) => assertion.valueTeam!.toLowerCase());
    const lineOfBusiness = effectiveValue(of(mine, "line_of_business"), superseded, (assertion) => lines.get(assertion.valueLineOfBusinessId!)!, (assertion) => String(assertion.valueLineOfBusinessId));
    const memberships = effectivePortals(of(mine, "portal"), superseded, deWeb).map((membership) => ({ portal: portalRefs.get(membership.portalId)!, provenance: membership.provenance, flagged: membership.flagged }));
    result.set(id, {
      application,
      team,
      lineOfBusiness,
      portals: memberships,
      deWeb,
      asOf: asOfLatest(team.provenance?.recordedAt, lineOfBusiness.provenance?.recordedAt, ...memberships.filter((item) => !item.flagged).map((item) => item.provenance.recordedAt)),
    });
  }
  return result;
}

export function repositoryOwnership(db: Executor, repositorySourceIds: readonly number[]): Map<number, RepositoryOwnership> {
  const ids = [...new Set(repositorySourceIds)];
  if (ids.length === 0) return new Map();
  const repositories = refsOf(db, "repository", ids);
  const links = db.select().from(ownershipAssertions).where(and(inArray(ownershipAssertions.subjectRepositorySourceId, ids), eq(ownershipAssertions.attribute, "application"))).all();
  const linkSuperseded = supersededAmong(db, links);
  const linkedApplications = refsOf(db, "application", links.map((assertion) => assertion.valueApplicationId!));
  const linked = new Map(ids.map((id) => [id, effectiveValue(links.filter((assertion) => assertion.subjectRepositorySourceId === id), linkSuperseded, (assertion) => linkedApplications.get(assertion.valueApplicationId!)!, (assertion) => String(assertion.valueApplicationId))]));
  const applications = applicationOwnership(db, [...linked.values()].map((effective) => effective.value?.id).filter((id): id is number => id !== undefined));
  const hosted = hostedPortals(db, ids);

  const result = new Map<number, RepositoryOwnership>();
  for (const id of ids) {
    const repository = repositories.get(id);
    if (!repository) continue;
    const application = linked.get(id)!;
    const owned = application.value ? applications.get(application.value.id) : undefined;
    result.set(id, {
      repository,
      application,
      team: owned?.team ?? UNKNOWN,
      lineOfBusiness: owned?.lineOfBusiness ?? UNKNOWN,
      portals: owned?.portals ?? [],
      hosts: hosted.get(id) ?? [],
      deWeb: owned?.deWeb ?? false,
      asOf: asOfLatest(application.provenance?.recordedAt, owned?.asOf),
    });
  }
  return result;
}

/** Ownership of the given portals, or of every portal. */
export function portalOwnership(db: Executor, portalIds?: readonly number[]): Map<number, PortalOwnership> {
  const refs = portalIds ? labelsOf(db, "portal", portalIds) : new Map(db.select().from(portals).all().map((portal) => [portal.id, labelRef(portal)]));
  const ids = [...refs.keys()];
  if (ids.length === 0) return new Map();
  const assertions = db.select().from(ownershipAssertions).where(inArray(ownershipAssertions.subjectPortalId, ids)).all();
  const superseded = supersededAmong(db, assertions);
  const owners = refsOf(db, "application", assertions.map((assertion) => assertion.valueApplicationId));
  const hosts = refsOf(db, "repository", assertions.map((assertion) => assertion.valueRepositorySourceId));
  const effectiveOwners = new Map(ids.map((id) => [id, effectiveValue(of(assertions, "owner", id), superseded, (assertion) => owners.get(assertion.valueApplicationId!)!, (assertion) => String(assertion.valueApplicationId))]));
  const ownerships = applicationOwnership(db, [...effectiveOwners.values()].map((owner) => owner.value?.id).filter((id): id is number => id !== undefined));

  const result = new Map<number, PortalOwnership>();
  for (const id of ids) {
    const owner = effectiveOwners.get(id)!;
    const host = effectiveValue(of(assertions, "host", id), superseded, (assertion) => hosts.get(assertion.valueRepositorySourceId!)!, (assertion) => String(assertion.valueRepositorySourceId));
    const lineOfBusiness = owner.value ? (ownerships.get(owner.value.id)?.lineOfBusiness ?? UNKNOWN) : UNKNOWN;
    result.set(id, { portal: refs.get(id)!, owner, host, lineOfBusiness, asOf: asOfLatest(owner.provenance?.recordedAt, host.provenance?.recordedAt, lineOfBusiness.provenance?.recordedAt) });
  }
  return result;
}

/** Current ownership of every repository an Assessment covers, by target, however long ago it ran. */
export function ownershipForAssessment(db: Executor, assessmentId: number): { byTarget: Map<number, RepositoryOwnership>; asOf: Date | null } {
  const rows = db.select({ id: assessmentTargets.id, repositorySourceId: assessmentTargets.repositorySourceId }).from(assessmentTargets).where(eq(assessmentTargets.assessmentId, assessmentId)).all();
  // A template target has no repository, so no owner.
  const targets = rows.flatMap(({ id, repositorySourceId }) => (repositorySourceId === null ? [] : [{ id, repositorySourceId }]));
  const owned = repositoryOwnership(db, targets.map((target) => target.repositorySourceId));
  const byTarget = new Map<number, RepositoryOwnership>();
  for (const target of targets) {
    const ownership = owned.get(target.repositorySourceId);
    if (ownership) byTarget.set(target.id, ownership);
  }
  return { byTarget, asOf: asOfLatest(...[...byTarget.values()].map((ownership) => ownership.asOf)) };
}

/** The portals whose effective host is each repository. */
function hostedPortals(db: Executor, repositoryIds: readonly number[]): Map<number, LabelRef[]> {
  const claimed = db
    .select({ portal: ownershipAssertions.subjectPortalId })
    .from(ownershipAssertions)
    .where(and(eq(ownershipAssertions.attribute, "host"), inArray(ownershipAssertions.valueRepositorySourceId, repositoryIds)))
    .all()
    .map((row) => row.portal!);
  const result = new Map<number, LabelRef[]>();
  for (const ownership of portalOwnership(db, [...new Set(claimed)]).values()) {
    const host = ownership.host.value;
    if (host) result.set(host.id, [...(result.get(host.id) ?? []), ownership.portal]);
  }
  return result;
}

function of(assertions: readonly OwnershipAssertion[], attribute: OwnershipAssertion["attribute"], portalId?: number): OwnershipAssertion[] {
  return assertions.filter((assertion) => assertion.attribute === attribute && (portalId === undefined || assertion.subjectPortalId === portalId));
}

/** The ids, among +assertions+, that a later assertion supersedes. */
function supersededAmong(db: Executor, assertions: readonly OwnershipAssertion[]): Set<number> {
  if (assertions.length === 0) return new Set();
  const ids = assertions.map((assertion) => assertion.id);
  return new Set(
    db
      .select({ id: ownershipSupersessions.supersededId })
      .from(ownershipSupersessions)
      .where(or(...chunked(ids).map((chunk) => inArray(ownershipSupersessions.supersededId, chunk))))
      .all()
      .map((row) => row.id),
  );
}

function refsOf(db: Executor, kind: "application", ids: readonly (number | null)[]): Map<number, ApplicationRef>;
function refsOf(db: Executor, kind: "repository", ids: readonly (number | null)[]): Map<number, RepositoryRef>;
function refsOf(db: Executor, kind: "application" | "repository", ids: readonly (number | null)[]): Map<number, ApplicationRef | RepositoryRef> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
  if (wanted.length === 0) return new Map();
  if (kind === "application") {
    return new Map(
      db
        .select({ id: applications.id, publicId: applications.publicId, sealId: applications.sealId, name: applications.name })
        .from(applications)
        .where(inArray(applications.id, wanted))
        .all()
        .map((row) => [row.id, row]),
    );
  }
  return new Map(
    db
      .select({ id: repositorySources.id, publicId: repositorySources.publicId, name: repositorySources.name })
      .from(repositorySources)
      .where(inArray(repositorySources.id, wanted))
      .all()
      .map((row) => [row.id, row]),
  );
}

function labelsOf(db: Executor, kind: "portal" | "lineOfBusiness", ids: readonly (number | null)[]): Map<number, LabelRef> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
  if (wanted.length === 0) return new Map();
  const table = kind === "portal" ? portals : linesOfBusiness;
  return new Map(db.select().from(table).where(inArray(table.id, wanted)).all().map((row) => [row.id, labelRef(row)]));
}

function labelRef(row: { id: number; publicId: string; label: string; conceptKey: string | null }): LabelRef {
  return { id: row.id, publicId: row.publicId, label: row.label, conceptKey: row.conceptKey };
}

function chunked<T>(values: readonly T[], size = 500): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < values.length; start += size) chunks.push(values.slice(start, start + size));
  return chunks;
}
