import { compareCodeUnits } from "@repo-facts/contract";
import { and, asc, eq, exists, isNotNull, ne, sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { applicationComponents, applicationPlacements, applications, microfrontendRevisions, microfrontends, placementRoutes, portalEnvironments, portalRevisions, portals, repositorySources } from "@/lib/db/schema";
import type { PortalPlatform } from "./vocabulary";

/*
 * The Web Onboarding catalogs: each Portal, Web Application, and MFE with
 * the facts its list shows, searched on the server so a search works
 * without JavaScript and lives in the URL.
 */

const matches = (needle: string, ...values: (string | null | undefined)[]) => !needle || values.some((value) => value?.toLowerCase().includes(needle));

export function portalCatalog(db: Executor, search = "") {
  const needle = search.trim().toLowerCase();
  const all = db.select().from(portals).all();
  const latest = new Map(
    db
      .select({ portalId: portalRevisions.portalId, id: sql<number>`max(${portalRevisions.id})`, number: sql<number>`max(${portalRevisions.number})` })
      .from(portalRevisions)
      .where(eq(portalRevisions.state, "submitted"))
      .groupBy(portalRevisions.portalId)
      .all()
      .map((row) => [row.portalId, row]),
  );
  const environments = new Map<number, string[]>();
  for (const row of db.select({ revision: portalEnvironments.portalRevisionId, environment: portalEnvironments.environment }).from(portalEnvironments).all()) environments.set(row.revision, [...(environments.get(row.revision) ?? []), row.environment]);
  const placements = new Map(
    db
      .select({ portalId: placementRoutes.portalId, count: sql<number>`count(distinct ${placementRoutes.placementId})` })
      .from(placementRoutes)
      .where(eq(placementRoutes.active, true))
      .groupBy(placementRoutes.portalId)
      .all()
      .map((row) => [row.portalId, row.count]),
  );
  return all
    .filter((portal) => matches(needle, portal.label, portal.ownerTeam, portal.sealId))
    .map((portal) => {
      const revision = portal.activeRevisionId ?? latest.get(portal.id)?.id ?? null;
      return {
        portal,
        revision: latest.get(portal.id)?.number ?? null,
        draft: portal.draftRevisionId !== null,
        environments: revision ? (environments.get(revision) ?? []).sort(compareCodeUnits) : [],
        placements: placements.get(portal.id) ?? 0,
      };
    })
    .sort((a, b) => compareCodeUnits(a.portal.label.toLowerCase(), b.portal.label.toLowerCase()));
}

/** Narrows the Application catalog to Applications with at least one placement, in any review state, in the Portal with this id (portal-switcher spec). */
export interface ApplicationScope {
  portalId?: number | null;
}

export function applicationCatalog(db: Executor, search = "", scope: ApplicationScope = {}) {
  const needle = search.trim().toLowerCase();
  const launch = new Map(
    db
      .all<{ application_id: number; kind: "mfe" | "external"; mode: string; number: number }>(sql`
        select r.application_id, t.kind, t.rendering_mode as mode, r.number
        from application_launch_targets t join application_revisions r on r.id = t.application_revision_id
        join applications a on a.active_revision_id = r.id`)
      .map((row) => [row.application_id, row]),
  );
  const placements = new Map(
    db
      .select({ applicationId: placementRoutes.applicationId, portals: sql<string>`group_concat(distinct ${placementRoutes.portalId})` })
      .from(placementRoutes)
      .where(eq(placementRoutes.active, true))
      .groupBy(placementRoutes.applicationId)
      .all()
      .map((row) => [row.applicationId, row.portals.split(",").length]),
  );
  const placedIn = scope.portalId == null ? null : new Set(db.selectDistinct({ applicationId: applicationPlacements.applicationId }).from(applicationPlacements).where(eq(applicationPlacements.portalId, scope.portalId)).all().map((row) => row.applicationId));
  return db
    .select()
    .from(applications)
    .all()
    .filter((application) => !placedIn || placedIn.has(application.id))
    .filter((application) => matches(needle, application.name, application.ownerTeam, application.sealId, application.publicId))
    .map((application) => ({ application, launch: launch.get(application.id) ?? null, portals: placements.get(application.id) ?? 0, draft: application.draftRevisionId !== null }))
    .sort((a, b) => compareCodeUnits((a.application.name ?? a.application.sealId ?? "").toLowerCase(), (b.application.name ?? b.application.sealId ?? "").toLowerCase()) || compareCodeUnits(a.application.publicId, b.application.publicId));
}

export function microfrontendCatalog(db: Executor, search = "") {
  const needle = search.trim().toLowerCase();
  const sources = new Map(
    db
      .select({ id: microfrontendRevisions.id, repository: repositorySources.name, path: microfrontendRevisions.workspacePath })
      .from(microfrontendRevisions)
      .innerJoin(repositorySources, eq(repositorySources.id, microfrontendRevisions.repositorySourceId))
      .where(isNotNull(microfrontendRevisions.repositorySourceId))
      .all()
      .map((row) => [row.id, row]),
  );
  const uses = new Map(
    db
      .select({ microfrontendId: applicationComponents.microfrontendId, count: sql<number>`count(distinct ${applications.id})` })
      .from(applicationComponents)
      .innerJoin(applications, and(eq(applications.activeRevisionId, applicationComponents.applicationRevisionId)))
      .groupBy(applicationComponents.microfrontendId)
      .all()
      .map((row) => [row.microfrontendId, row.count]),
  );
  return db
    .select()
    .from(microfrontends)
    .all()
    .filter((mfe) => matches(needle, mfe.name, mfe.ownerTeam, mfe.sealId, mfe.cdaasAppId, mfe.cdaasViewId))
    .map((mfe) => ({ microfrontend: mfe, source: mfe.activeRevisionId ? (sources.get(mfe.activeRevisionId) ?? null) : null, uses: uses.get(mfe.id) ?? 0, draft: mfe.draftRevisionId !== null }))
    .sort((a, b) => compareCodeUnits(a.microfrontend.name.toLowerCase(), b.microfrontend.name.toLowerCase()));
}

/** A Portal as the sidebar's switcher lists it. */
export interface SwitcherPortal {
  publicId: string;
  label: string;
  slug: string | null;
  sealId: string | null;
  platform: PortalPlatform | null;
}

/**
 * The Portals the sidebar's switcher offers (portal-switcher spec): every
 * onboarded Portal, one with a configuration revision, that isn't Retired,
 * sorted by name. A Portal named only in an ownership claim isn't onboarded.
 * One narrow query, since the shell runs it on every page.
 */
export function portalSwitcherList(db: Executor): SwitcherPortal[] {
  return db
    .select({ publicId: portals.publicId, label: portals.label, slug: portals.slug, sealId: portals.sealId, platform: portals.platform })
    .from(portals)
    .where(and(ne(portals.lifecycle, "retired"), exists(db.select({ one: sql`1` }).from(portalRevisions).where(eq(portalRevisions.portalId, portals.id)))))
    .orderBy(asc(portals.labelKey), asc(portals.publicId))
    .all();
}
