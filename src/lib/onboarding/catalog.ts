import { compareCodeUnits } from "@repo-facts/contract";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Executor } from "@/lib/db/client";
import { applicationComponents, applications, microfrontendRevisions, microfrontends, placementRoutes, portalEnvironments, portalRevisions, portals, repositorySources } from "@/lib/db/schema";

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

export function applicationCatalog(db: Executor, search = "") {
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
  return db
    .select()
    .from(applications)
    .all()
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
