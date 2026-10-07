import { compareCodeUnits } from "@repo-facts/contract";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { type Executor, immediate } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, TransitionError, ValidationError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import {
  type PlacementDecisionKind,
  type PlacementState,
  applicationPlacements,
  applicationRevisions,
  applications,
  placementDecisions,
  placementRequestEnvironments,
  placementRequests,
  placementRoutes,
  portalDefaultRoutes,
  portalEnvironments,
  portalMenuGroups,
  portalRevisions,
  portals,
} from "@/lib/db/schema";
import type { Application } from "@/lib/ownership/records";
import { applicationName, getApplication, refreshApplicationReadiness, requestState } from "./applications";
import type { Actor } from "./attribution";
import { type Entitlements, canonicalize, entitlementsSchema } from "./documents";
import { BlockedError, type ValidationIssue } from "./issues";
import { currentDefault } from "./placements";
import { type Portal, governingRevision } from "./portals";
import { normalizeRoute, ROUTE_PROBLEMS } from "./routes";

/*
 * Placement reviews (reviews spec). Each placement of an Application in a
 * Portal is reviewed by that Portal's owner, independently of every other
 * placement and Portal. Decisions are appended in order against the exact
 * Portal revision, Application revision, and placement request they
 * evaluated; a decision made from a page that's since changed is refused.
 * Approval records the route, menu parent, label, ordering, entitlements,
 * and default the Portal owner accepted, which need not be what was
 * requested: a placement's entitlements are decided here and nowhere else,
 * environment by environment, and no Portal revision holds them. Every
 * decision is attributed to the identity its maker stated, labeled
 * Unverified, and none of them changes Studio, CDaaS, or ServiceNow.
 */

export type Decision = typeof placementDecisions.$inferSelect;
type Request = typeof placementRequests.$inferSelect;

/** Raised when a decision was based on an older state of the request; it carries what's current. */
export class StaleDecisionError extends StaleRecordError {
  override name = "StaleDecisionError";

  constructor(
    readonly current: { state: PlacementState; sequence: number; latest: Decision | null },
    message: string,
  ) {
    super(message);
  }
}

export interface AcceptedValues {
  route: string;
  menuParent: string | null;
  label: string;
  order: number;
  entitlements: Entitlements;
  /** The environments this approval makes the placement the default of. */
  defaults: readonly string[];
}

export interface DecisionInput {
  placement: string;
  /** The Application revision whose request is decided. */
  revision: number;
  /** How many decisions the request had when the decider opened it. */
  expectedSequence: number;
  decision: PlacementDecisionKind;
  reason?: string | null;
  /** For an approval: the values the Portal owner accepts. Omitted values take the requested ones. */
  accepted?: Partial<AcceptedValues>;
  /** For a retirement or withdrawal of a default: the approved placement that takes over each environment. */
  replacementDefaults?: Readonly<Record<string, string>>;
  actor: Actor;
}

interface Loaded {
  placement: typeof applicationPlacements.$inferSelect;
  portal: Portal;
  application: Application;
  request: Request;
  revisionNumber: number;
  environments: string[];
  decisions: Decision[];
  state: PlacementState;
}

function load(db: Executor, placementPublicId: string, revision: number): Loaded {
  const placement = db.select().from(applicationPlacements).where(eq(applicationPlacements.publicId, placementPublicId)).get();
  if (!placement) throw new NotFoundError(`Placement ${placementPublicId} doesn't exist`);
  const row = db
    .select({ request: placementRequests, number: applicationRevisions.number })
    .from(placementRequests)
    .innerJoin(applicationRevisions, eq(applicationRevisions.id, placementRequests.applicationRevisionId))
    .where(and(eq(placementRequests.placementId, placement.id), eq(applicationRevisions.number, revision)))
    .get();
  if (!row) throw new NotFoundError(`Revision ${revision} doesn't request this placement`);
  const decisions = db.select().from(placementDecisions).where(eq(placementDecisions.placementRequestId, row.request.id)).orderBy(asc(placementDecisions.sequence)).all();
  return {
    placement,
    portal: db.select().from(portals).where(eq(portals.id, placement.portalId)).get()!,
    application: db.select().from(applications).where(eq(applications.id, placement.applicationId)).get()!,
    request: row.request,
    revisionNumber: row.number,
    environments: db.select({ environment: placementRequestEnvironments.environment }).from(placementRequestEnvironments).where(eq(placementRequestEnvironments.placementRequestId, row.request.id)).all().map((item) => item.environment).sort(compareCodeUnits),
    decisions,
    state: requestState(decisions.at(-1)?.decision ?? null),
  };
}

const ALLOWED: Record<PlacementState, readonly PlacementDecisionKind[]> = {
  pending: ["approve", "reject", "withdraw"],
  approved: ["retire", "withdraw"],
  rejected: [],
  withdrawn: [],
  retired: [],
};

const DECISION_LABELS: Record<PlacementDecisionKind, string> = { approve: "approved", reject: "rejected", withdraw: "withdrawn", retire: "retired" };

/**
 * Records one decision about one placement request. Approval checks that
 * the Portal still enables each requested environment and that the accepted
 * route is free in each, records the entitlements the owner accepted,
 * activates the routes, and makes the placement the default of the
 * environments the owner chose, all in one transaction. Retiring or withdrawing an active default needs an
 * approved replacement in each of its environments while the Portal is
 * Active.
 */
export function decidePlacement(db: Executor, input: DecisionInput): Decision {
  return immediate(db, (tx) => {
    const loaded = load(tx, input.placement, input.revision);
    const { placement, portal, request, decisions, state } = loaded;
    if (decisions.length !== input.expectedSequence) {
      const latest = decisions.at(-1) ?? null;
      throw new StaleDecisionError(
        { state, sequence: decisions.length, latest },
        latest ? `This placement was ${DECISION_LABELS[latest.decision]} by ${latest.actor} after you opened it` : "This placement changed after you opened it",
      );
    }
    if (!ALLOWED[state].includes(input.decision)) throw new TransitionError(`${/^[aeiou]/.test(state) ? "An" : "A"} ${state} placement can't be ${DECISION_LABELS[input.decision]}`);
    if (portal.lifecycle === "retired" && input.decision === "approve") throw new TransitionError(`${portal.label} is retired`);
    const governing = governingRevision(tx, portal);
    if (!governing) throw new TransitionError(`${portal.label} has no submitted configuration`);
    const reason = input.reason?.trim() || null;
    if ((input.decision === "reject" || input.decision === "retire") && !reason) throw new ValidationError([{ field: "reason", message: input.decision === "reject" ? "Say why the placement is rejected" : "Say why the placement is retired" }]);
    if (reason && reason.length > 1000) throw new ValidationError([{ field: "reason", message: "Use 1,000 characters or fewer" }]);
    const now = new Date();

    let accepted: { route: string; menuParent: string | null; label: string; order: number; entitlements: string; defaults: string[] } | null = null;
    if (input.decision === "approve") accepted = acceptedValues(tx, loaded, governing.id, input.accepted ?? {});
    // Only a decision that stops the routes being served moves a default: withdrawing a pending request leaves an earlier approval, and its defaults, in place.
    const unserves = input.decision === "retire" || (input.decision === "withdraw" && state === "approved");
    if (unserves) protectDefaults(tx, loaded, input.replacementDefaults ?? {}, input.actor, now);

    const decision = tx
      .insert(placementDecisions)
      .values({
        publicId: generatePublicId("pdc"),
        placementId: placement.id,
        placementRequestId: request.id,
        portalRevisionId: governing.id,
        applicationRevisionId: request.applicationRevisionId,
        sequence: decisions.length,
        decision: input.decision,
        reason,
        acceptedRoute: accepted?.route ?? null,
        acceptedMenuParentKey: accepted?.menuParent ?? null,
        acceptedLabel: accepted?.label ?? null,
        acceptedOrdering: accepted?.order ?? null,
        acceptedEntitlements: accepted?.entitlements ?? null,
        acceptedDefaults: accepted ? JSON.stringify(accepted.defaults) : null,
        actor: input.actor.name,
        attribution: input.actor.attribution,
        decidedAt: now,
      })
      .returning()
      .get();

    if (accepted) {
      // A newer approval replaces the routes an earlier request of the same placement held.
      deactivateRoutes(tx, placement.id, now);
      for (const environment of loaded.environments) {
        tx.insert(placementRoutes).values({ placementId: placement.id, decisionId: decision.id, portalId: portal.id, applicationId: placement.applicationId, environment, route: accepted.route, activatedAt: now }).run();
      }
      for (const environment of accepted.defaults) {
        const current = currentDefault(tx, portal.id, environment);
        if (current.placementId === placement.id) continue;
        tx.insert(portalDefaultRoutes).values({ portalId: portal.id, environment, sequence: current.sequence, placementId: placement.id, decisionId: decision.id, actor: input.actor.name, attribution: input.actor.attribution, assignedAt: now }).run();
      }
    } else if (unserves) {
      deactivateRoutes(tx, placement.id, now);
    }
    refreshApplicationReadiness(tx, getApplication(tx, loaded.application.publicId), input.actor, now);
    return decision;
  });
}

/** The values an approval records: the owner's, or the requested ones, checked against the Portal's environments and routes now. */
function acceptedValues(db: Executor, loaded: Loaded, governingId: number, given: Partial<AcceptedValues>) {
  const { request, portal, placement } = loaded;
  const issues: ValidationIssue[] = [];
  const block = (code: string, location: string, message: string) => issues.push({ code, severity: "blocking", location, message });
  const route = normalizeRoute(given.route ?? request.route);
  if (route.problem) throw new ValidationError([{ field: "route", message: ROUTE_PROBLEMS[route.problem] }]);
  const label = (given.label ?? request.label).trim().replace(/\s+/g, " ");
  if (!label || label.length > 100) throw new ValidationError([{ field: "label", message: "Enter the menu label, 100 characters or fewer" }]);
  const order = given.order ?? request.ordering;
  if (!Number.isInteger(order) || order < 0 || order > 100_000) throw new ValidationError([{ field: "order", message: "Enter a position from 0 to 100,000" }]);
  const menuParent = given.menuParent === undefined ? request.menuParentKey : given.menuParent?.trim() || null;
  const groups = new Set(db.select({ key: portalMenuGroups.key }).from(portalMenuGroups).where(eq(portalMenuGroups.portalRevisionId, governingId)).all().map((group) => group.key));
  if (menuParent && !groups.has(menuParent)) throw new ValidationError([{ field: "menuParent", message: `${portal.label} has no menu group ${menuParent}` }]);
  const entitlements = canonicalize(entitlementsSchema, given.entitlements ?? JSON.parse(request.entitlements), "entitlements").text;
  const environments = db.select().from(portalEnvironments).where(eq(portalEnvironments.portalRevisionId, governingId)).all();
  for (const environment of loaded.environments) {
    const configured = environments.find((row) => row.environment === environment);
    if (!configured?.enabled) block("placement.environment_unavailable", `environments.${environment}`, `${portal.label} has no enabled ${environment.toUpperCase()} environment now`);
    const occupant = db
      .select({ application: applications.name, publicId: applications.publicId })
      .from(placementRoutes)
      .innerJoin(applications, eq(applications.id, placementRoutes.applicationId))
      .where(and(eq(placementRoutes.portalId, portal.id), eq(placementRoutes.environment, environment), eq(placementRoutes.route, route.route!), eq(placementRoutes.active, true), sql`${placementRoutes.placementId} <> ${placement.id}`))
      .get();
    if (occupant) block("placement.route_collision", "route", `${portal.label} ${environment.toUpperCase()} already serves ${route.route} for ${occupant.application ?? occupant.publicId}`);
  }
  const requestedDefaults = request.defaultRequested ? loaded.environments.filter((environment) => !currentDefault(db, portal.id, environment).placementId) : [];
  const defaults = [...new Set(given.defaults ?? requestedDefaults)].sort(compareCodeUnits);
  for (const environment of defaults) if (!loaded.environments.includes(environment)) block("placement.default_environment", `defaults.${environment}`, `The placement isn't requested in ${environment.toUpperCase()}, so it can't be its default`);
  if (issues.length > 0) throw new BlockedError(`The placement can't be approved`, issues);
  return { route: route.route!, menuParent, label, order, entitlements, defaults };
}

/**
 * Before a default placement's routes go, each environment it's the default
 * of gets the replacement named for it, an approved placement active there.
 * An Active Portal must name one; a Portal not yet Active may be left with no
 * default.
 */
function protectDefaults(db: Executor, loaded: Loaded, replacements: Readonly<Record<string, string>>, actor: Actor, now: Date): void {
  const { placement, portal } = loaded;
  const environments = db.selectDistinct({ environment: portalDefaultRoutes.environment }).from(portalDefaultRoutes).where(eq(portalDefaultRoutes.portalId, portal.id)).all();
  const issues: ValidationIssue[] = [];
  for (const { environment } of environments) {
    const current = currentDefault(db, portal.id, environment);
    if (current.placementId !== placement.id) continue;
    const replacement = replacements[environment];
    if (!replacement) {
      if (portal.lifecycle === "active") {
        issues.push({ code: "placement.default_protected", severity: "blocking", location: `defaults.${environment}`, message: `This placement is ${portal.label}'s default in ${environment.toUpperCase()}. Choose another approved placement to become the default first` });
      } else {
        db.insert(portalDefaultRoutes).values({ portalId: portal.id, environment, sequence: current.sequence, placementId: null, actor: actor.name, attribution: actor.attribution, assignedAt: now }).run();
      }
      continue;
    }
    const next = db.select().from(applicationPlacements).where(eq(applicationPlacements.publicId, replacement)).get();
    const active = next ? db.select({ id: placementRoutes.id }).from(placementRoutes).where(and(eq(placementRoutes.placementId, next.id), eq(placementRoutes.environment, environment), eq(placementRoutes.active, true))).get() : undefined;
    if (!next || next.id === placement.id || next.portalId !== portal.id || !active) {
      issues.push({ code: "placement.default_replacement_invalid", severity: "blocking", location: `defaults.${environment}`, message: `The replacement default must be another placement approved in ${portal.label} ${environment.toUpperCase()}` });
      continue;
    }
    db.insert(portalDefaultRoutes).values({ portalId: portal.id, environment, sequence: current.sequence, placementId: next.id, actor: actor.name, attribution: actor.attribution, assignedAt: now }).run();
  }
  if (issues.length > 0) throw new BlockedError(`The placement can't be removed yet`, issues);
}

function deactivateRoutes(db: Executor, placementId: number, now: Date): void {
  db.update(placementRoutes).set({ active: false, deactivatedAt: now }).where(and(eq(placementRoutes.placementId, placementId), eq(placementRoutes.active, true))).run();
}

/**
 * Makes an approved placement a Portal environment's default, or, for a
 * Portal not yet Active, clears it. The assignment names how many came
 * before, so one made from a stale page is refused.
 */
export function assignDefault(db: Executor, input: { portal: string; environment: string; placement: string | null; expectedSequence: number; actor: Actor }): void {
  immediate(db, (tx) => {
    const portal = tx.select().from(portals).where(eq(portals.publicId, input.portal)).get();
    if (!portal) throw new NotFoundError(`Portal ${input.portal} doesn't exist`);
    if (portal.lifecycle === "retired") throw new TransitionError(`${portal.label} is retired`);
    const current = currentDefault(tx, portal.id, input.environment);
    if (current.sequence !== input.expectedSequence) throw new StaleRecordError(`${portal.label}'s ${input.environment.toUpperCase()} default changed after you opened it`);
    let placementId: number | null = null;
    if (input.placement) {
      const placement = tx.select().from(applicationPlacements).where(eq(applicationPlacements.publicId, input.placement)).get();
      const active = placement ? tx.select({ id: placementRoutes.id }).from(placementRoutes).where(and(eq(placementRoutes.placementId, placement.id), eq(placementRoutes.environment, input.environment), eq(placementRoutes.active, true))).get() : undefined;
      if (!placement || placement.portalId !== portal.id || !active) throw new ValidationError([{ field: "placement", message: `Choose a placement approved in ${portal.label} ${input.environment.toUpperCase()}` }]);
      placementId = placement.id;
    } else if (portal.lifecycle === "active") {
      throw new BlockedError(`The default can't be cleared`, [{ code: "portal.default_required", severity: "blocking", location: `defaults.${input.environment}`, message: `${portal.label} is Active, so ${input.environment.toUpperCase()} needs a default route` }]);
    }
    if (placementId === current.placementId) return;
    tx.insert(portalDefaultRoutes).values({ portalId: portal.id, environment: input.environment, sequence: current.sequence, placementId, actor: input.actor.name, attribution: input.actor.attribution, assignedAt: new Date() }).run();
  });
}

// ---------------------------------------------------------------------------
// Reading

export interface DecisionView {
  decision: Decision;
  portalRevision: number;
  applicationRevision: number;
}

export interface PlacementReview {
  placement: typeof applicationPlacements.$inferSelect;
  portal: Portal;
  application: Application;
  /** The latest request: what's being, or was last, reviewed. */
  request: Request;
  revision: number;
  environments: string[];
  state: PlacementState;
  /** What the Portal serves now: approved while an earlier approval stays active. */
  effective: PlacementState;
  /** The request whose approval is active, when it isn't the latest one. */
  activeRequest: { request: Request; revision: number; decision: Decision } | null;
  decisions: DecisionView[];
  /** Every decision about every request of this placement, oldest first. */
  history: DecisionView[];
  sequence: number;
  submittedBy: string | null;
  submittedAt: Date | null;
}

/** One placement's review: its latest request and state, the approval active now, and every decision. */
export function placementReview(db: Executor, placementPublicId: string): PlacementReview | undefined {
  const placement = db.select().from(applicationPlacements).where(eq(applicationPlacements.publicId, placementPublicId)).get();
  if (!placement) return undefined;
  const latest = db
    .select({ request: placementRequests, revision: applicationRevisions })
    .from(placementRequests)
    .innerJoin(applicationRevisions, eq(applicationRevisions.id, placementRequests.applicationRevisionId))
    .where(eq(placementRequests.placementId, placement.id))
    .orderBy(desc(applicationRevisions.number))
    .limit(1)
    .get();
  if (!latest) return undefined;
  const loaded = load(db, placementPublicId, latest.revision.number);
  const history = decisionViews(db, db.select().from(placementDecisions).where(eq(placementDecisions.placementId, placement.id)).orderBy(asc(placementDecisions.decidedAt), asc(placementDecisions.id)).all());
  const activeRoute = db.select({ decisionId: placementRoutes.decisionId }).from(placementRoutes).where(and(eq(placementRoutes.placementId, placement.id), eq(placementRoutes.active, true))).limit(1).get();
  let activeRequest: PlacementReview["activeRequest"] = null;
  if (activeRoute) {
    const decision = history.find((view) => view.decision.id === activeRoute.decisionId)!;
    if (decision.decision.placementRequestId !== loaded.request.id) {
      activeRequest = { request: db.select().from(placementRequests).where(eq(placementRequests.id, decision.decision.placementRequestId)).get()!, revision: decision.applicationRevision, decision: decision.decision };
    }
  }
  return {
    placement,
    portal: loaded.portal,
    application: loaded.application,
    request: loaded.request,
    revision: loaded.revisionNumber,
    environments: loaded.environments,
    state: loaded.state,
    effective: activeRoute ? "approved" : loaded.state,
    activeRequest,
    decisions: history.filter((view) => view.decision.placementRequestId === loaded.request.id),
    history,
    sequence: loaded.decisions.length,
    submittedBy: latest.revision.submittedBy,
    submittedAt: latest.revision.submittedAt,
  };
}

function decisionViews(db: Executor, decisions: Decision[]): DecisionView[] {
  if (decisions.length === 0) return [];
  const portalNumbers = new Map(db.select({ id: portalRevisions.id, number: portalRevisions.number }).from(portalRevisions).where(inArray(portalRevisions.id, [...new Set(decisions.map((decision) => decision.portalRevisionId))])).all().map((row) => [row.id, row.number]));
  const applicationNumbers = new Map(db.select({ id: applicationRevisions.id, number: applicationRevisions.number }).from(applicationRevisions).where(inArray(applicationRevisions.id, [...new Set(decisions.map((decision) => decision.applicationRevisionId))])).all().map((row) => [row.id, row.number]));
  return decisions.map((decision) => ({ decision, portalRevision: portalNumbers.get(decision.portalRevisionId)!, applicationRevision: applicationNumbers.get(decision.applicationRevisionId)! }));
}

export interface ReviewRow {
  placement: string;
  portal: { publicId: string; name: string };
  application: { publicId: string; name: string; sealId: string | null };
  route: string;
  revision: number;
  state: PlacementState;
  effective: PlacementState;
  submittedBy: string | null;
  /** When the latest request was made, or last decided. */
  since: Date;
}

export const REVIEW_STATES = ["pending", "approved", "rejected", "withdrawn", "retired"] as const satisfies readonly PlacementState[];

/** The review queue: one row per placement, for its latest request, filtered and searched. */
export function reviewQueue(db: Executor, filters: { state?: PlacementState | null; portal?: string | null; search?: string | null } = {}): ReviewRow[] {
  const rows = db.all<{ placement: string; portal_public: string; portal_name: string; application_public: string; application_name: string | null; seal_id: string | null; route: string; revision: number; submitted_by: string | null; created_at: number; decision: string | null; decided_at: number | null; active: number }>(sql`
    select p.public_id as placement, po.public_id as portal_public, po.label as portal_name, a.public_id as application_public, a.name as application_name, a.seal_id as seal_id,
      r.route as route, ar.number as revision, ar.submitted_by as submitted_by, r.created_at as created_at,
      (select decision from placement_decisions d where d.placement_request_id = r.id order by sequence desc limit 1) as decision,
      (select decided_at from placement_decisions d where d.placement_request_id = r.id order by sequence desc limit 1) as decided_at,
      exists (select 1 from placement_routes pr where pr.placement_id = p.id and pr.active = 1) as active
    from application_placements p
    join portals po on po.id = p.portal_id
    join applications a on a.id = p.application_id
    join placement_requests r on r.placement_id = p.id
    join application_revisions ar on ar.id = r.application_revision_id
    where ar.number = (select max(ar2.number) from placement_requests r2 join application_revisions ar2 on ar2.id = r2.application_revision_id where r2.placement_id = p.id)`);
  const search = filters.search?.trim().toLowerCase();
  return rows
    .map((row) => {
      const state = requestState(row.decision);
      return {
        placement: row.placement,
        portal: { publicId: row.portal_public, name: row.portal_name },
        application: { publicId: row.application_public, name: row.application_name ?? row.seal_id ?? "Unnamed application", sealId: row.seal_id },
        route: row.route,
        revision: row.revision,
        state,
        effective: row.active ? ("approved" as const) : state,
        submittedBy: row.submitted_by,
        since: new Date(row.decided_at ?? row.created_at),
      };
    })
    .filter((row) => !filters.state || row.state === filters.state)
    .filter((row) => !filters.portal || row.portal.publicId === filters.portal)
    .filter((row) => !search || [row.application.name, row.application.sealId, row.portal.name, row.route, row.submittedBy].some((value) => value?.toLowerCase().includes(search)))
    .sort((a, b) => (a.state === "pending" ? 0 : 1) - (b.state === "pending" ? 0 : 1) || a.since.getTime() - b.since.getTime() || compareCodeUnits(a.application.name, b.application.name));
}

/** How a placement review is titled: the Application, then the Portal. */
export function reviewTitle(review: Pick<PlacementReview, "application" | "portal">): string {
  return `${applicationName(review.application)} · ${review.portal.label}`;
}
