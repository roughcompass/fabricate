import { compareCodeUnits } from "@repo-facts/contract";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { applicationPlacements, applications, placementDecisions, placementRoutes, portalDefaultRoutes, portalMenuGroups, portals } from "@/lib/db/schema";

/*
 * What Portals serve (design decision 4): the routes approved placements
 * occupy, each Portal environment's default, and the effective menu, which
 * is a Portal revision's non-actionable groups with the approved placements
 * as their leaves.
 */

export interface ActiveRoute {
  routeId: number;
  placementId: number;
  placement: string;
  decisionId: number;
  applicationId: number;
  application: string;
  applicationName: string | null;
  environment: string;
  route: string;
  label: string;
  ordering: number;
  menuParentKey: string | null;
}

/** The routes approved placements occupy in a Portal, in one environment or all. */
export function activeRoutes(db: Executor, portalId: number, environment?: string): ActiveRoute[] {
  return db
    .select({
      routeId: placementRoutes.id,
      placementId: placementRoutes.placementId,
      placement: applicationPlacements.publicId,
      decisionId: placementRoutes.decisionId,
      applicationId: placementRoutes.applicationId,
      application: applications.publicId,
      applicationName: applications.name,
      environment: placementRoutes.environment,
      route: placementRoutes.route,
      label: placementDecisions.acceptedLabel,
      ordering: placementDecisions.acceptedOrdering,
      menuParentKey: placementDecisions.acceptedMenuParentKey,
    })
    .from(placementRoutes)
    .innerJoin(applicationPlacements, eq(applicationPlacements.id, placementRoutes.placementId))
    .innerJoin(applications, eq(applications.id, placementRoutes.applicationId))
    .innerJoin(placementDecisions, eq(placementDecisions.id, placementRoutes.decisionId))
    .where(and(eq(placementRoutes.portalId, portalId), eq(placementRoutes.active, true), environment ? eq(placementRoutes.environment, environment) : undefined))
    .orderBy(asc(placementRoutes.environment), asc(placementRoutes.route))
    .all()
    .map((row) => ({ ...row, label: row.label!, ordering: row.ordering! }));
}

export interface DefaultRoute {
  /** The number of assignments so far, which the next one names. */
  sequence: number;
  placementId: number | null;
  placement: string | null;
  assignedAt: Date | null;
  actor: string | null;
}

/** A Portal environment's current default placement, with the count of assignments so far. */
export function currentDefault(db: Executor, portalId: number, environment: string): DefaultRoute {
  const latest = db
    .select({ sequence: portalDefaultRoutes.sequence, placementId: portalDefaultRoutes.placementId, placement: applicationPlacements.publicId, assignedAt: portalDefaultRoutes.assignedAt, actor: portalDefaultRoutes.actor })
    .from(portalDefaultRoutes)
    .leftJoin(applicationPlacements, eq(applicationPlacements.id, portalDefaultRoutes.placementId))
    .where(and(eq(portalDefaultRoutes.portalId, portalId), eq(portalDefaultRoutes.environment, environment)))
    .orderBy(desc(portalDefaultRoutes.sequence))
    .limit(1)
    .get();
  if (!latest) return { sequence: 0, placementId: null, placement: null, assignedAt: null, actor: null };
  return { sequence: latest.sequence + 1, placementId: latest.placementId, placement: latest.placement, assignedAt: latest.assignedAt, actor: latest.actor };
}

export type MenuNode =
  | { kind: "group"; key: string; label: string; ordering: number; children: MenuNode[] }
  | { kind: "placement"; placement: string; application: string; applicationName: string | null; route: string; label: string; ordering: number; isDefault: boolean; orphaned: boolean };

export interface EffectiveMenu {
  /** The Portal revision whose groups the menu uses: the active one, or the latest submitted before activation. */
  revisionId: number | null;
  environment: string;
  nodes: MenuNode[];
  defaultPlacement: string | null;
}

/**
 * A Portal environment's menu: its revision's groups, with each approved
 * placement as a leaf under the parent the Portal owner accepted. A
 * placement whose parent the revision no longer has is shown at the top,
 * marked orphaned.
 */
export function effectiveMenu(db: Executor, portalId: number, revisionId: number | null, environment: string): EffectiveMenu {
  const groups = revisionId === null ? [] : db.select().from(portalMenuGroups).where(eq(portalMenuGroups.portalRevisionId, revisionId)).all();
  const nodes = new Map(groups.map((group) => [group.key, { kind: "group" as const, key: group.key, label: group.label, ordering: group.ordering, children: [] as MenuNode[] }]));
  const roots: MenuNode[] = [];
  for (const group of groups) (group.parentKey && nodes.has(group.parentKey) ? nodes.get(group.parentKey)!.children : roots).push(nodes.get(group.key)!);
  const defaultPlacement = currentDefault(db, portalId, environment).placement;
  for (const route of activeRoutes(db, portalId, environment)) {
    const parent = route.menuParentKey ? nodes.get(route.menuParentKey) : undefined;
    const leaf: MenuNode = {
      kind: "placement",
      placement: route.placement,
      application: route.application,
      applicationName: route.applicationName,
      route: route.route,
      label: route.label,
      ordering: route.ordering,
      isDefault: route.placement === defaultPlacement,
      orphaned: route.menuParentKey !== null && !parent,
    };
    (parent ? parent.children : roots).push(leaf);
  }
  const sort = (list: MenuNode[]) => {
    list.sort((a, b) => a.ordering - b.ordering || compareCodeUnits(a.label, b.label));
    for (const node of list) if (node.kind === "group") sort(node.children);
  };
  sort(roots);
  return { revisionId, environment, nodes: roots, defaultPlacement };
}

/** The Portal a placement belongs to, by public ID. */
export function placementPortal(db: Executor, placementId: number) {
  return db.select({ portal: portals }).from(applicationPlacements).innerJoin(portals, eq(portals.id, applicationPlacements.portalId)).where(eq(applicationPlacements.id, placementId)).get()?.portal;
}
