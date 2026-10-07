import { compareCodeUnits } from "@repo-facts/contract";
import { and, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { applicationComponents, applicationLaunchTargets, applicationPlacements, applications, microfrontendRevisions, microfrontends, placementDecisions, placementRoutes, portalEnvironments, portals } from "@/lib/db/schema";
import type { Application } from "@/lib/ownership/records";
import { applicationName, modeOfStudioTypes } from "../applications";
import { contractLabel } from "../contracts";
import { RENDERING_MODE_LABELS } from "../documents";
import { type Microfrontend, cdaasComparison } from "../microfrontends";
import { type Portal, governingRevision } from "../portals";
import { revisionById } from "../revisions";
import { STALE_AFTER_MS, evidenceOf } from "./evidence";
import { type Comparison, type Expectation, RECONCILIATION_STATES, type ReconciliationState, reconcile } from "./reconcile";
import { type ExternalReference, referenceOf } from "./references";

/*
 * Current state, compared (design decision 8). Each comparison names the
 * submitted revision whose value is expected and the observation it's
 * compared with, and is one of Matching, Missing, Conflicting, Unknown, or
 * Stale. A record with no mapping to compare is Unknown, never Matching.
 */

export interface StateItem extends Comparison {
  /** What's compared, such as "Studio channel" or "Payee search in module group". */
  subject: string;
}

const evidence = (db: Executor, reference: ExternalReference | undefined, now: Date, staleAfterMs: number) => (reference ? evidenceOf(db, reference, now, staleAfterMs) : null);
const text = (value: unknown) => (typeof value === "string" ? value : value === null || value === undefined ? null : String(value));
const listed = (field: string, expected: string) => (projection: Record<string, unknown>) => ((projection[field] as string[] | undefined)?.includes(expected) ? expected : "Not listed");

export interface StateOptions {
  now?: Date;
  staleAfterMs?: number;
}

/** A Portal's Studio channel, and the Studio environment each of its environments names. */
export function portalState(db: Executor, portal: Portal, options: StateOptions = {}): StateItem[] {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  const revision = governingRevision(db, portal);
  const desired = revision ? `${portal.label} revision ${revision.number}` : portal.label;
  const subject = { kind: "portal" as const, id: portal.id };
  const items: StateItem[] = [];
  const channelExpectations: Expectation[] = portal.sealId ? [{ label: "SEAL ID", expected: portal.sealId, observed: (projection) => text(projection.sealId) }] : [];
  items.push({ subject: "Studio channel", ...reconcile({ system: "studio", resourceLabel: "Studio channel", desired, evidence: evidence(db, referenceOf(db, subject, "studio", "channel"), now, staleAfterMs), expectations: channelExpectations }) });
  if (revision) {
    for (const environment of db.select().from(portalEnvironments).where(eq(portalEnvironments.portalRevisionId, revision.id)).all().sort((a, b) => compareCodeUnits(a.environment, b.environment))) {
      const reference = referenceOf(db, subject, "studio", "environment", environment.environment);
      items.push({
        subject: `${environment.environment.toUpperCase()} Studio environment`,
        ...reconcile({ system: "studio", resourceLabel: "Studio environment", desired, evidence: evidence(db, reference, now, staleAfterMs), expectations: reference ? [{ label: "Label", expected: reference.externalId, observed: (projection) => text(projection.label) }] : [] }),
      });
    }
  }
  return items;
}

/** An MFE's CDaaS view and its live version, and its Studio module when it has one. */
export function microfrontendState(db: Executor, mfe: Microfrontend, options: StateOptions = {}): StateItem[] {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  const row = mfe.activeRevisionId ? (db.select().from(microfrontendRevisions).where(eq(microfrontendRevisions.id, mfe.activeRevisionId)).get() ?? null) : null;
  const desired = row ? contractLabel(mfe.name, row.number, "").trim() : mfe.name;
  const subject = { kind: "microfrontend" as const, id: mfe.id };
  const items: StateItem[] = [{ subject: "CDaaS view", ...cdaasComparison(db, mfe, row, now) }];
  const view = referenceOf(db, subject, "cdaas", "application_view");
  const versions = reconcile({ system: "cdaas", resourceLabel: "CDaaS application view", desired, evidence: evidence(db, view, now, staleAfterMs), expectations: [] });
  const projection = versions.state === "matching" ? evidence(db, view, now, staleAfterMs)!.observation!.projectionValue : null;
  const live = (projection?.versions as { name: string; live: boolean }[] | undefined)?.filter((version) => version.live) ?? [];
  items.push({
    subject: "Live version",
    ...versions,
    ...(versions.state === "matching" && live.length === 0 ? { state: "missing" as const, reason: "CDaaS reports no live version of this view" } : versions.state === "matching" ? { reason: `CDaaS serves ${live.map((version) => version.name).join(", ")}` } : {}),
    values: [{ label: "Live version", expected: "Any", observed: projection ? live.map((version) => version.name).join(", ") || "None" : null, matches: live.length > 0 }],
  });
  const studioModule = referenceOf(db, subject, "studio", "module");
  if (studioModule) {
    items.push({
      subject: "Studio module",
      ...reconcile({
        system: "studio",
        resourceLabel: "Studio module",
        desired,
        evidence: evidence(db, studioModule, now, staleAfterMs),
        expectations: row?.cdaasAppId ? [{ label: "CDaaS appId", expected: row.cdaasAppId, observed: (value) => text(value.appId) }] : [],
      }),
    });
  }
  return items;
}

/**
 * An Application's Studio module group, compared with its current revision:
 * the launch target's module and each required child's module must be in
 * the group, and the rendering mode Studio's module type states must be the
 * confirmed one.
 */
export function applicationState(db: Executor, application: Application, options: StateOptions = {}): StateItem[] {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  const revision = application.activeRevisionId ? revisionById(db, "application", application.activeRevisionId) : undefined;
  const desired = revision ? `${applicationName(application)} revision ${revision.number}` : applicationName(application);
  const group = referenceOf(db, { kind: "application", id: application.id }, "studio", "module_group");
  const groupEvidence = evidence(db, group, now, staleAfterMs);
  const items: StateItem[] = [];
  const target = revision ? db.select().from(applicationLaunchTargets).where(eq(applicationLaunchTargets.applicationRevisionId, revision.id)).get() : undefined;
  const components = revision
    ? db.select({ component: applicationComponents, microfrontend: microfrontends }).from(applicationComponents).innerJoin(microfrontends, eq(microfrontends.id, applicationComponents.microfrontendId)).where(eq(applicationComponents.applicationRevisionId, revision.id)).all()
    : [];
  const groupExpectations: Expectation[] = application.sealId ? [{ label: "SEAL ID", expected: application.sealId, observed: (projection) => text(projection.sealId) }] : [];
  items.push({ subject: "Studio module group", ...reconcile({ system: "studio", resourceLabel: "Studio module group", desired, evidence: groupEvidence, expectations: groupExpectations }) });

  for (const { component, microfrontend } of components) {
    if (component.role === "child" && !component.required) continue;
    const studioModule = referenceOf(db, { kind: "microfrontend", id: microfrontend.id }, "studio", "module");
    const role = component.role === "entry" ? "Launch target" : "Required child";
    items.push({
      subject: `${role} ${microfrontend.name} in the module group`,
      ...(studioModule
        ? reconcile({ system: "studio", resourceLabel: "Studio module group", desired, evidence: groupEvidence, expectations: [{ label: `${microfrontend.name}'s module`, expected: studioModule.externalId, observed: listed("moduleUuids", studioModule.externalId) }] })
        : { ...reconcile({ system: "studio", resourceLabel: "Studio module", desired, evidence: null, expectations: [] }), reason: `${microfrontend.name} has no Studio module mapped, so nothing shows the module group loads it` }),
    });
  }

  if (target?.kind === "mfe") {
    const entry = components.find((row) => row.component.role === "entry")?.microfrontend;
    const studioModule = entry ? referenceOf(db, { kind: "microfrontend", id: entry.id }, "studio", "module") : undefined;
    const comparison = reconcile({ system: "studio", resourceLabel: "Studio module", desired, evidence: evidence(db, studioModule, now, staleAfterMs), expectations: [{ label: "Rendering mode", expected: RENDERING_MODE_LABELS[target.renderingMode], observed: (projection) => { const mode = modeOfStudioTypes((projection.typeLabels as string[]) ?? []); return mode ? RENDERING_MODE_LABELS[mode] : null; } }] });
    // A Studio type that names no mode is unknown evidence, not a conflict.
    items.push({ subject: "Rendering mode", ...(comparison.state === "conflicting" && comparison.values[0]?.observed === null ? { ...comparison, state: "unknown" as const, reason: "The Studio module's type doesn't name a rendering mode" } : comparison) });
  } else if (target) {
    items.push({ subject: "Rendering mode", state: "unknown", reason: "An external endpoint isn't read, so only the team's confirmation states its mode", system: "studio", desired, reference: null, values: [{ label: "Rendering mode", expected: RENDERING_MODE_LABELS[target.renderingMode], observed: null, matches: false }], observedAt: null, readAt: null });
  }
  return items;
}

/**
 * A placement's Studio menu in each environment it's approved in, compared
 * with what the Portal owner accepted: the label, the Portal's channel, the
 * launch target's module, and the entitlement codes. Studio's menu contract
 * has no route field, so the route itself isn't compared.
 */
export function placementState(db: Executor, placementId: number, options: StateOptions = {}): StateItem[] {
  const now = options.now ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  const placement = db.select().from(applicationPlacements).where(eq(applicationPlacements.id, placementId)).get();
  if (!placement) return [];
  const portal = db.select().from(portals).where(eq(portals.id, placement.portalId)).get()!;
  const application = db.select().from(applications).where(eq(applications.id, placement.applicationId)).get()!;
  const routes = db.select({ route: placementRoutes, decision: placementDecisions }).from(placementRoutes).innerJoin(placementDecisions, eq(placementDecisions.id, placementRoutes.decisionId)).where(and(eq(placementRoutes.placementId, placement.id), eq(placementRoutes.active, true))).all();
  const channel = referenceOf(db, { kind: "portal", id: portal.id }, "studio", "channel");
  const entry = application.activeRevisionId ? db.select({ microfrontendId: applicationComponents.microfrontendId }).from(applicationComponents).where(and(eq(applicationComponents.applicationRevisionId, application.activeRevisionId), eq(applicationComponents.role, "entry"))).get() : undefined;
  const studioModule = entry ? referenceOf(db, { kind: "microfrontend", id: entry.microfrontendId }, "studio", "module") : undefined;
  return routes
    .sort((a, b) => compareCodeUnits(a.route.environment, b.route.environment))
    .map(({ route, decision }) => {
      const reference = referenceOf(db, { kind: "placement", id: placement.id }, "studio", "menu", route.environment);
      const codes = (JSON.parse(decision.acceptedEntitlements ?? '{"codes":[]}') as { codes: string[] }).codes.join(", ");
      const expectations: Expectation[] = [
        { label: "Label", expected: decision.acceptedLabel, observed: (projection) => text(projection.name) },
        { label: "Entitlement codes", expected: codes, observed: (projection) => [...((projection.entitlementCodes as string[]) ?? [])].sort(compareCodeUnits).join(", ") },
      ];
      if (channel) expectations.push({ label: "Studio channel", expected: channel.externalId, observed: (projection) => text(projection.channelUuid) });
      if (studioModule) expectations.push({ label: "Launch target's module", expected: studioModule.externalId, observed: listed("moduleUuids", studioModule.externalId) });
      return { subject: `${route.environment.toUpperCase()} Studio menu for ${route.route}`, ...reconcile({ system: "studio", resourceLabel: "Studio menu", desired: `${applicationName(application)} in ${portal.label}, approved for revision ${decision.applicationRevisionId}`, evidence: evidence(db, reference, now, staleAfterMs), expectations }) };
    });
}

/** Results grouped by state, in the order a person reads them: what needs attention first. */
export function groupByState<T extends { state: ReconciliationState }>(items: readonly T[]): { state: ReconciliationState; items: T[] }[] {
  const order: ReconciliationState[] = ["conflicting", "missing", "stale", "unknown", "matching"];
  return order.map((state) => ({ state, items: items.filter((item) => item.state === state) })).filter((group) => group.items.length > 0);
}

export { RECONCILIATION_STATES };
