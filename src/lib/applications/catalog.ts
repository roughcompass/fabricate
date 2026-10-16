import { compareCodeUnits } from "@repo-facts/contract";
import { sql } from "drizzle-orm";
import { type AssessmentState, applicationAssessments, applications, assessments, portals, repositorySources } from "@/lib/db/schema";
import type { Executor } from "@/lib/db/client";
import type { PortalLifecycle } from "@/lib/onboarding/vocabulary";
import { type ApplicationAssessmentStateId, applicationStateOfRun } from "./assessment";
import { type GitProvider, parseRepositoryUrl } from "./repository-url";
import type { RenderingMode } from "./vocabulary";

/*
 * The registered Applications, as the Applications page and the application
 * switcher list them (application-catalog spec): each with its repository,
 * Portal, assessment state, and rendering determination, most recently
 * changed first. One query, whatever the number of Applications; search and
 * filters apply in memory over at most a few hundred rows.
 */

/** The Filter's assessment-state options, each covering the states it names. */
export const ASSESSMENT_FILTERS = { assessing: ["queued", "assessing"], assessed: ["assessed", "assessed_with_issues"], failed: ["failed", "couldnt_start"] } as const satisfies Record<string, readonly ApplicationAssessmentStateId[]>;
export type AssessmentFilter = keyof typeof ASSESSMENT_FILTERS;
export const ASSESSMENT_FILTER_LABELS: Record<AssessmentFilter, string> = { assessing: "Assessing", assessed: "Assessed", failed: "Failed" };

export interface ApplicationRow {
  publicId: string;
  name: string;
  slug: string;
  sealId: string;
  repository: { publicId: string; cloneUrl: string; provider: GitProvider | null; label: string; webUrl: string | null };
  portal: { publicId: string; label: string; lifecycle: PortalLifecycle };
  assessment: ApplicationAssessmentStateId;
  rendering: RenderingMode | null;
  changedAt: Date;
}

export interface ApplicationQuery {
  /** The Portal row id to scope to, or null for every Portal. */
  portalId?: number | null;
  search?: string;
  rendering?: readonly RenderingMode[];
  states?: readonly AssessmentFilter[];
}

/** owner/name for a provider's repository, or the last path segments of any other URL. */
function repositoryOf(cloneUrl: string, bitbucketHosts: readonly string[]): Omit<ApplicationRow["repository"], "publicId" | "cloneUrl"> {
  try {
    const parsed = parseRepositoryUrl(cloneUrl, { bitbucketHosts, allowLocal: true });
    return { provider: parsed.provider, label: parsed.owner ? `${parsed.owner}/${parsed.name}` : parsed.name, webUrl: parsed.webUrl };
  } catch {
    return { provider: null, label: cloneUrl.split("/").filter(Boolean).slice(-2).join("/").replace(/\.git$/, ""), webUrl: null };
  }
}

/** Whether +row+ matches the search: its name, slug, SEAL ID, or repository URL, ignoring case. */
export function matchesSearch(row: Pick<ApplicationRow, "name" | "slug" | "sealId" | "repository">, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return !needle || [row.name, row.slug, row.sealId, row.repository.cloneUrl, row.repository.label, row.repository.webUrl].some((value) => value?.toLowerCase().includes(needle));
}

/**
 * The registered Applications in +query+'s Portal, or every Portal, that
 * match its search and filters, most recently changed first, ties by name.
 * Applications named only in ownership claims, which have no repository,
 * aren't listed.
 */
export function applicationCatalog(db: Executor, query: ApplicationQuery = {}, bitbucketHosts: readonly string[] = []): ApplicationRow[] {
  const rows = db.all<{
    public_id: string;
    name: string;
    slug: string;
    seal_id: string;
    rendering_mode: RenderingMode | null;
    updated_at: number;
    source_public_id: string;
    clone_url: string;
    portal_public_id: string;
    portal_label: string;
    portal_lifecycle: PortalLifecycle;
    portal_id: number;
    launch_error: string | null;
    run_state: AssessmentState | null;
  }>(sql`
    select a.public_id, a.name, a.slug, a.seal_id, a.rendering_mode, a.updated_at,
      s.public_id as source_public_id, s.clone_url, p.id as portal_id, p.public_id as portal_public_id, p.label as portal_label, p.lifecycle as portal_lifecycle,
      l.error as launch_error, r.state as run_state
    from ${applications} a
    join ${repositorySources} s on s.id = a.repository_source_id
    join ${portals} p on p.id = a.portal_id
    left join ${applicationAssessments} l on l.id = (select max(id) from ${applicationAssessments} where application_id = a.id)
    left join ${assessments} r on r.id = l.assessment_id
    where a.repository_source_id is not null`);
  const states = new Set<ApplicationAssessmentStateId>(query.states?.flatMap((filter) => ASSESSMENT_FILTERS[filter]) ?? []);
  return rows
    .filter((row) => query.portalId == null || row.portal_id === query.portalId)
    .map((row): ApplicationRow => ({
      publicId: row.public_id,
      name: row.name,
      slug: row.slug,
      sealId: row.seal_id,
      repository: { publicId: row.source_public_id, cloneUrl: row.clone_url, ...repositoryOf(row.clone_url, bitbucketHosts) },
      portal: { publicId: row.portal_public_id, label: row.portal_label, lifecycle: row.portal_lifecycle },
      assessment: row.run_state ? applicationStateOfRun(row.run_state) : row.launch_error ? "couldnt_start" : "not_assessed",
      rendering: row.rendering_mode,
      changedAt: new Date(row.updated_at),
    }))
    .filter((row) => matchesSearch(row, query.search ?? ""))
    .filter((row) => !query.rendering?.length || (row.rendering !== null && query.rendering.includes(row.rendering)))
    .filter((row) => states.size === 0 || states.has(row.assessment))
    .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime() || compareCodeUnits(a.name.toLowerCase(), b.name.toLowerCase()));
}
