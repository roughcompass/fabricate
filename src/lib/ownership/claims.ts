import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Assessment } from "@/lib/assessments/assessment-records";
import { assessmentById } from "@/lib/assessments/lookups";
import { launchAssessment } from "@/lib/assessments/launcher";
import { resolveCloneUrl } from "@/lib/catalog/catalog";
import { CloneUrl, InvalidCloneUrl } from "@/lib/catalog/clone-url";
import { BoundaryViolation, type SourceBoundary } from "@/lib/catalog/source-boundary";
import { type RepositorySource, findSourceByCanonicalUrl, getSource, insertSource } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { IssueCollector, ValidationError, isUniqueViolation } from "@/lib/db/errors";
import { assessmentTargets, assessments, linesOfBusiness, ownershipAssertions, ownershipSupersessions, portals, repositoryProfiles } from "@/lib/db/schema";
import { claimInitiative } from "@/lib/initiatives/initiative-records";
import { type Candidate, provenanceOf } from "./effective";
import { type ApplicationOwnership, type LabelRef, type PortalOwnership, type RepositoryOwnership, applicationOwnership, portalOwnership, repositoryOwnership } from "./read";
import { type Application, type AssertionClaim, type OwnershipAssertion, type Portal, SEAL_ID, applicationLabel, applicationsWithSealId, createApplication, ensureLineOfBusiness, ensurePortal, findApplication, labelKey, recordAssertion } from "./records";

/*
 * The claim flow (design decision 2): a person enters a git URL, then answers
 * only what isn't known. The application comes first, because it decides
 * what's known: a DE Web application's team and portals come from the DE
 * Console, and an application claimed before already has its values. Each
 * answer is an unverified assertion from the identity the person entered,
 * until Bitbucket verification exists. Completing a claim starts a Run of the
 * repository when it has no complete one.
 *
 * An application is chosen by its identity. A SEAL ID only finds candidates:
 * several applications may carry one, so a SEAL ID that more than one
 * carries is resolved by the claimant, and a new SEAL ID makes a new
 * application rather than joining an existing one by name.
 */

export { SEAL_ID } from "./records";
const MAX_PORTALS = 20;

export interface Claimant {
  providedBy: string;
  /** The person the values are credited to, when that's someone else. */
  attributedTo?: string;
}

/**
 * Finds the catalog entry for a git URL by its canonical form, or registers
 * one under the catalog's URL rules. A rejected URL is never stored.
 */
export function locateRepository(db: Executor, url: string, boundary?: SourceBoundary): { source: RepositorySource; created: boolean } {
  let resolved: { cloneUrl: string; canonicalUrl: string };
  try {
    resolved = resolveCloneUrl(url, boundary);
  } catch (error) {
    if (error instanceof InvalidCloneUrl || error instanceof BoundaryViolation) throw new ValidationError([{ field: "cloneUrl", message: error.message }]);
    throw error;
  }
  return immediate(db, (tx) => {
    const found = findSourceByCanonicalUrl(tx, resolved.canonicalUrl);
    if (found) return { source: found, created: false };
    try {
      return { source: insertSource(tx, { name: repositoryName(resolved.canonicalUrl), ...resolved }), created: true };
    } catch (error) {
      // Someone registered the same URL a moment earlier.
      if (error instanceof ValidationError || isUniqueViolation(error)) {
        const raced = findSourceByCanonicalUrl(tx, resolved.canonicalUrl);
        if (raced) return { source: raced, created: false };
      }
      throw error;
    }
  });
}

/** A display name from the URL's last path segment, "orders" for ".../team/orders.git". */
export function repositoryName(canonicalUrl: string): string {
  const segment = CloneUrl.parse(canonicalUrl).path.split("/").filter(Boolean).at(-1) ?? "repository";
  return segment.replace(/\.git$/, "").slice(0, 100) || "repository";
}

interface ClaimQuestions {
  /** Which application the repository belongs to. */
  application: boolean;
  team: boolean;
  lineOfBusiness: boolean;
  portals: boolean;
}

/** How a claim names its application: an existing one, or a SEAL ID that finds candidates or makes a new one. */
export interface ApplicationChoice {
  /** An existing application's public ID. */
  application?: string | null;
  sealId?: string | null;
  /** Make a new application with +sealId+ even though others carry it. */
  newApplication?: boolean;
  /** Ask which application carries +sealId+ even when only one does. */
  choose?: boolean;
}

export interface ClaimView {
  source: RepositorySource;
  ownership: RepositoryOwnership;
  /** The application the repository is linked to, or the existing one this claim chose. */
  record: Application | null;
  /** The SEAL ID of the new application this claim makes, when it makes one. */
  newSealId: string | null;
  /** A SEAL ID that names several applications, or one the claimant asked to choose for. */
  sealId: string | null;
  /** The applications carrying +sealId+, for the claimant to choose between. */
  sameSeal: Application[];
  /** True when the repository is already linked to its application. */
  linked: boolean;
  /** The application's current ownership, when it's known at all. */
  application: ApplicationOwnership | null;
  /** True when the DE Console lists the application. */
  deWeb: boolean;
  asks: ClaimQuestions;
  /** Linked, with nothing left to ask (Known repository). */
  known: boolean;
}

/** An existing application a choice names, the SEAL ID of a new one, and the applications its SEAL ID finds. */
interface ResolvedChoice {
  record: Application | null;
  newSealId: string | null;
  sealId: string | null;
  sameSeal: Application[];
}

/**
 * Resolves a choice: a named application; or a SEAL ID that no application
 * carries, so it makes a new one; or one application carries, so it names
 * it; or several carry, so the person must choose. Nothing is merged.
 */
function resolveChoice(db: Executor, choice: ApplicationChoice): ResolvedChoice {
  const sealId = choice.sealId?.trim() || null;
  if (choice.application) return { record: findApplication(db, choice.application) ?? null, newSealId: null, sealId, sameSeal: [] };
  if (!sealId) return { record: null, newSealId: null, sealId: null, sameSeal: [] };
  const sameSeal = applicationsWithSealId(db, sealId);
  if (choice.newApplication || sameSeal.length === 0) return { record: null, newSealId: sealId, sealId, sameSeal: [] };
  if (sameSeal.length === 1 && !choice.choose) return { record: sameSeal[0]!, newSealId: null, sealId, sameSeal: [] };
  return { record: null, newSealId: null, sealId, sameSeal };
}

/** What a claim of +source+ knows, and what it still has to ask, for an optionally chosen application. */
export function claimView(db: Executor, source: RepositorySource, choice: ApplicationChoice = {}): ClaimView {
  const ownership = repositoryOwnership(db, [source.id]).get(source.id)!;
  const linkedRef = ownership.application.value;
  const resolved: ResolvedChoice = linkedRef ? { record: findApplication(db, linkedRef.publicId) ?? null, newSealId: null, sealId: null, sameSeal: [] } : resolveChoice(db, choice);
  const { record, newSealId } = resolved;
  const application = record ? (applicationOwnership(db, [record.id]).get(record.id) ?? null) : null;
  const deWeb = application?.deWeb ?? false;
  const chosen = record !== null || newSealId !== null;
  const asks: ClaimQuestions = {
    application: !chosen,
    team: chosen && !application?.team.value,
    lineOfBusiness: chosen && !application?.lineOfBusiness.value,
    // A DE Web application's portals are the DE Console's, even when it lists none.
    portals: chosen && !deWeb && !application?.portals.length,
  };
  return {
    source,
    ownership,
    record,
    newSealId,
    sealId: chosen ? null : resolved.sealId,
    sameSeal: resolved.sameSeal,
    linked: linkedRef !== null,
    application,
    deWeb,
    asks,
    known: linkedRef !== null && !asks.team && !asks.lineOfBusiness && !asks.portals,
  };
}

/** How the application a claim chose reads: its name and SEAL ID, or the SEAL ID of the new one. */
export function chosenLabel(view: ClaimView): string | null {
  if (view.record) return applicationLabel(view.record);
  return view.newSealId;
}

export interface ClaimChoices {
  portals: LabelRef[];
  linesOfBusiness: LabelRef[];
}

/** The approved portals and Lines of Business: values an ontology release approved. Pending values aren't offered. */
export function claimChoices(db: Executor): ClaimChoices {
  const approved = (table: typeof portals | typeof linesOfBusiness) =>
    db
      .select({ id: table.id, publicId: table.publicId, label: table.label, conceptKey: table.conceptKey })
      .from(table)
      .where(isNotNull(table.conceptKey))
      .orderBy(table.labelKey)
      .all();
  return { portals: approved(portals), linesOfBusiness: approved(linesOfBusiness) };
}

export interface ClaimInput extends Claimant, ApplicationChoice {
  team?: string;
  lineOfBusiness?: string;
  portals?: readonly string[];
  /** A portal this repository hosts. */
  hosts?: string;
  launchToken?: string;
}

export interface ClaimResult {
  /** The Run the claim started, if the repository had no complete one. */
  started: Assessment | null;
  /** A portal the repository hosts that has no owner: its application is proposed as owner. */
  ownerProposal: Portal | null;
}

/**
 * Records a claim's answers, asking again only for what's still unknown when
 * it's submitted, and starts a Run when the repository has no complete one.
 * Everything commits together, or nothing does.
 */
export function completeClaim(db: Executor, sourcePublicId: string, input: ClaimInput, config: FabricateConfig = getConfig()): ClaimResult {
  return immediate(db, (tx) => {
    const source = getSource(tx, sourcePublicId);
    const issues = new IssueCollector();
    const claimant = validClaimant(input, issues);
    const view = claimView(tx, source, input);
    if (view.asks.application) issues.add("application", applicationQuestion(view));
    else if (view.newSealId !== null && !SEAL_ID.test(view.newSealId)) issues.add("sealId", "Enter a SEAL ID of letters, digits, dots, dashes, or underscores");
    const team = view.asks.team ? required(input.team, 200, "team", "Enter the team that owns this application", issues) : null;
    const lineOfBusiness = view.asks.lineOfBusiness ? required(input.lineOfBusiness, 100, "lineOfBusiness", "Choose or enter a Line of Business", issues) : null;
    const portalLabels = view.asks.portals ? labels(input.portals ?? [], issues) : [];
    const hosts = input.hosts?.trim() ? required(input.hosts, 100, "hosts", "", issues) : null;
    issues.throwIfAny();

    const provenance = { ...claimant, source: "person" as const };
    const application = view.record ?? createApplication(tx, { sealId: view.newSealId! });
    if (!view.linked) recordAssertion(tx, { attribute: "application", repository: source.id, application: application.id, ...provenance });
    if (team) recordAssertion(tx, { attribute: "team", application: application.id, team, ...provenance });
    if (lineOfBusiness) recordAssertion(tx, { attribute: "line_of_business", application: application.id, lineOfBusiness: ensureLineOfBusiness(tx, lineOfBusiness).id, ...provenance });
    for (const label of portalLabels) recordAssertion(tx, { attribute: "portal", operation: "add", application: application.id, portal: ensurePortal(tx, label).id, ...provenance });

    let ownerProposal: Portal | null = null;
    if (hosts) {
      const portal = ensurePortal(tx, hosts);
      const current = portalOwnership(tx, [portal.id]).get(portal.id)!;
      // A second repository claimed as host stays beside the first: the host is then in conflict.
      if (!current.host.candidates.some((candidate) => candidate.value.id === source.id)) recordAssertion(tx, { attribute: "host", portal: portal.id, repository: source.id, ...provenance });
      if (!current.owner.value) ownerProposal = portal;
    }

    return { started: startRunIfNeeded(tx, source, input.launchToken ?? "", config), ownerProposal };
  });
}

/** Records the repository's application as owner of a portal it hosts that has no owner, once the claimant confirms it. */
export function confirmPortalOwner(db: Executor, sourcePublicId: string, portalPublicId: string, claimant: Claimant): void {
  immediate(db, (tx) => {
    const source = getSource(tx, sourcePublicId);
    const issues = new IssueCollector();
    const who = validClaimant(claimant, issues);
    issues.throwIfAny();
    const portal = tx.select().from(portals).where(eq(portals.publicId, portalPublicId)).get();
    const application = repositoryOwnership(tx, [source.id]).get(source.id)!.application.value;
    const ownership = portal ? portalOwnership(tx, [portal.id]).get(portal.id)! : undefined;
    if (!portal || !ownership || !application || !ownership.host.candidates.some((candidate) => candidate.value.id === source.id)) {
      throw new ValidationError([{ field: "base", message: "This Repository isn't claimed as the portal's host, so its application can't be proposed as owner" }]);
    }
    if (ownership.owner.value) throw new ValidationError([{ field: "base", message: `${portal.label} is already owned by ${applicationLabel(ownership.owner.value)}` }]);
    recordAssertion(tx, { attribute: "owner", portal: portal.id, application: application.id, ...who, source: "person" });
  });
}

export interface CorrectionInput extends Claimant {
  /** The application's SEAL ID: a different one moves the repository to an application that carries it, or to a new one. */
  sealId: string;
  /** The application chosen when several carry +sealId+. */
  application?: string | null;
  newApplication?: boolean;
  team?: string;
  lineOfBusiness?: string;
  portals?: readonly string[];
}

/**
 * Records corrections. A corrected value supersedes every current claim of
 * it, so a conflict clears and the history keeps every assertion. A value
 * resubmitted unchanged is recorded only when it's in conflict, to settle
 * it. Values from the DE Console aren't corrected here: the DE Console is
 * their record. Moving to another application is recorded alone, because
 * the other values belong to the application it names. When several
 * applications carry the new SEAL ID, the person chooses one.
 */
export function correctOwnership(db: Executor, sourcePublicId: string, input: CorrectionInput): { recorded: number; sealChanged: boolean } {
  return immediate(db, (tx) => {
    const source = getSource(tx, sourcePublicId);
    const issues = new IssueCollector();
    const claimant = validClaimant(input, issues);
    const view = claimView(tx, source);
    const sealId = input.sealId.trim();
    if (!SEAL_ID.test(sealId)) issues.add("sealId", "Enter a SEAL ID of letters, digits, dots, dashes, or underscores");
    issues.throwIfAny();
    const provenance = { ...claimant, source: "person" as const };
    let recorded = 0;
    const record = (claim: AssertionClaim, candidates: readonly Candidate<unknown>[]) => {
      recordAssertion(tx, { ...claim, ...provenance, supersedes: claimIds(tx, candidates) });
      recorded++;
    };

    const link = view.ownership.application;
    const current = link.value;
    const staying = current !== null && !input.newApplication && (input.application ? input.application === current.publicId : sealId === current.sealId);
    if (!staying) {
      const target = resolveChoice(tx, { application: input.application, sealId, newApplication: input.newApplication });
      if (!target.record && target.newSealId === null) {
        throw new ValidationError([{ field: "application", message: `${target.sameSeal.length} applications carry SEAL ID ${sealId}. Choose one, or a new application.` }]);
      }
      const application = target.record ?? createApplication(tx, { sealId: target.newSealId! });
      record({ attribute: "application", repository: source.id, application: application.id }, link.candidates);
      return { recorded, sealChanged: true };
    }
    if (link.conflict) {
      // Resubmitting the winning application settles the conflict.
      record({ attribute: "application", repository: source.id, application: current.id }, link.candidates);
      return { recorded, sealChanged: false };
    }

    const application = view.application!;
    const subject = application.application.id;
    if (application.team.provenance?.source !== "de_console") {
      const team = required(input.team, 200, "team", "Enter the team that owns this application", issues);
      if (team && (team !== application.team.value || application.team.conflict)) record({ attribute: "team", application: subject, team }, application.team.candidates);
    }
    const lineOfBusiness = required(input.lineOfBusiness, 100, "lineOfBusiness", "Choose or enter a Line of Business", issues);
    const currentLine = application.lineOfBusiness.value;
    if (lineOfBusiness && (labelKey(lineOfBusiness) !== labelKey(currentLine?.label ?? "") || application.lineOfBusiness.conflict)) {
      record({ attribute: "line_of_business", application: subject, lineOfBusiness: ensureLineOfBusiness(tx, lineOfBusiness).id }, application.lineOfBusiness.candidates);
    }
    if (!view.deWeb) {
      const wanted = new Map(labels(input.portals ?? [], issues).map((label) => [labelKey(label), label]));
      const current = new Map(application.portals.map((item) => [labelKey(item.portal.label), item]));
      for (const [key, label] of wanted) if (!current.has(key)) record({ attribute: "portal", operation: "add", application: subject, portal: ensurePortal(tx, label).id }, []);
      for (const [key, item] of current) {
        if (!wanted.has(key)) record({ attribute: "portal", operation: "remove", application: subject, portal: item.portal.id }, [{ value: item.portal, provenance: item.provenance }]);
      }
    }
    issues.throwIfAny();
    if (recorded === 0) throw new ValidationError([{ field: "base", message: "Nothing changed. Edit a value to correct it." }]);
    return { recorded, sealChanged: false };
  });
}

/** The portals this repository is claimed to host, each with its effective host and owner, and any conflict. */
export function hostClaims(db: Executor, sourceId: number): PortalOwnership[] {
  const claimed = db
    .selectDistinct({ portal: ownershipAssertions.subjectPortalId })
    .from(ownershipAssertions)
    .where(and(eq(ownershipAssertions.attribute, "host"), eq(ownershipAssertions.valueRepositorySourceId, sourceId)))
    .all()
    .map((row) => row.portal!);
  return [...portalOwnership(db, claimed).values()].filter((ownership) => ownership.host.candidates.some((candidate) => candidate.value.id === sourceId)).sort((a, b) => a.portal.label.localeCompare(b.portal.label));
}

export interface AssessmentState {
  /** The latest Profile of the repository, from a complete Run. */
  profile: { publicId: string; assessment: Assessment } | null;
  /** A Run of the repository that hasn't finished. */
  active: Assessment | null;
}

const ACTIVE = ["queued", "acquiring", "analyzing", "finalizing"] as const;

export function assessmentState(db: Executor, sourceId: number): AssessmentState {
  const profile = db
    .select({ publicId: repositoryProfiles.publicId, assessmentId: repositoryProfiles.assessmentId })
    .from(repositoryProfiles)
    .innerJoin(assessmentTargets, eq(assessmentTargets.id, repositoryProfiles.assessmentTargetId))
    .where(and(eq(assessmentTargets.repositorySourceId, sourceId), eq(assessmentTargets.state, "complete")))
    .orderBy(desc(repositoryProfiles.id))
    .limit(1)
    .get();
  const active = db
    .select({ id: assessments.id })
    .from(assessments)
    .innerJoin(assessmentTargets, eq(assessmentTargets.assessmentId, assessments.id))
    .where(and(eq(assessmentTargets.repositorySourceId, sourceId), inArray(assessments.state, [...ACTIVE])))
    .orderBy(desc(assessments.id))
    .limit(1)
    .get();
  return { profile: profile ? { publicId: profile.publicId, assessment: assessmentById(db, profile.assessmentId) } : null, active: active ? assessmentById(db, active.id) : null };
}

/** Starts a Run through the repository's system-owned initiative, unless it has a complete Run or one in progress. */
function startRunIfNeeded(db: Executor, source: RepositorySource, launchToken: string, config: FabricateConfig): Assessment | null {
  const state = assessmentState(db, source.id);
  if (state.profile || state.active) return null;
  const result = launchAssessment(db, claimInitiative(db, source).publicId, launchToken, config);
  return result.duplicate ? null : result.assessment;
}

/** What to ask when a claim hasn't settled its application. */
function applicationQuestion(view: ClaimView): string {
  if (view.sameSeal.length > 1) return `${view.sameSeal.length} applications carry SEAL ID ${view.sealId}. Choose one, or a new application.`;
  if (view.sameSeal.length === 1) return `Choose the application that carries SEAL ID ${view.sealId}, or a new one.`;
  return "Choose an application or enter a SEAL ID";
}

function validClaimant(input: Claimant, issues: IssueCollector): Required<Claimant> {
  const providedBy = input.providedBy.trim().replace(/\s+/g, " ");
  const attributedTo = (input.attributedTo ?? "").trim().replace(/\s+/g, " ");
  if (!providedBy) issues.add("providedBy", "Enter your name or email");
  else if (providedBy.length > 200) issues.add("providedBy", "Name or email must be 200 characters or fewer");
  if (attributedTo.length > 200) issues.add("attributedTo", "Name or email must be 200 characters or fewer");
  // Entering your own name here says nothing more.
  return { providedBy, attributedTo: attributedTo.toLowerCase() === providedBy.toLowerCase() ? "" : attributedTo };
}

function required(value: string | undefined, max: number, field: string, message: string, issues: IssueCollector): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) {
    if (message) issues.add(field, message);
    return null;
  }
  if (text.length > max) {
    issues.add(field, `Enter ${max} characters or fewer`);
    return null;
  }
  return text;
}

function labels(values: readonly string[], issues: IssueCollector): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const text = value.trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (text.length > 100) issues.add("portals", "Portal names must be 100 characters or fewer");
    else if (!unique.has(labelKey(text))) unique.set(labelKey(text), text);
  }
  if (unique.size === 0) issues.add("portals", "Choose or enter at least one portal");
  if (unique.size > MAX_PORTALS) issues.add("portals", `Choose ${MAX_PORTALS} portals or fewer`);
  return [...unique.values()];
}

/** The ids of the claims among +candidates+; the DE Console's assertions are never superseded by a person. */
function claimIds(db: Executor, candidates: readonly Candidate<unknown>[]): number[] {
  const publicIds = candidates.filter((candidate) => candidate.provenance.source !== "de_console").map((candidate) => candidate.provenance.assertion);
  if (publicIds.length === 0) return [];
  return db.select({ id: ownershipAssertions.id }).from(ownershipAssertions).where(inArray(ownershipAssertions.publicId, publicIds)).all().map((row) => row.id);
}

export interface HistoryEntry {
  assertion: OwnershipAssertion;
  provenance: ReturnType<typeof provenanceOf>;
  /** The public IDs of the assertions that superseded this one. */
  supersededBy: string[];
}

/** Every assertion about one attribute of an application, oldest first, with what superseded each. */
export function applicationHistory(db: Executor, applicationId: number, attribute: "team" | "line_of_business" | "portal"): HistoryEntry[] {
  const assertions = db
    .select()
    .from(ownershipAssertions)
    .where(and(eq(ownershipAssertions.subjectApplicationId, applicationId), eq(ownershipAssertions.attribute, attribute)))
    .orderBy(ownershipAssertions.recordedAt, ownershipAssertions.id)
    .all();
  const ids = assertions.map((assertion) => assertion.id);
  const byId = new Map(assertions.map((assertion) => [assertion.id, assertion.publicId]));
  const links = ids.length ? db.select().from(ownershipSupersessions).where(inArray(ownershipSupersessions.supersededId, ids)).all() : [];
  return assertions.map((assertion) => ({
    assertion,
    provenance: provenanceOf(assertion),
    supersededBy: links.filter((link) => link.supersededId === assertion.id).map((link) => byId.get(link.assertionId) ?? ""),
  }));
}
