import type { ConclusionFilter } from "@/lib/evaluations/conclusions";
import type { OwnershipFilter } from "@/lib/ownership/coverage";

/**
 * Addresses of the lists Home's figures open, with their filters
 * (page-patterns spec, "The Repositories and Assessments lists filter what
 * Home counts"). The lists build their own tab and filter links here too, so
 * a figure and the list it opens always agree on the parameters.
 */

const withQuery = (path: string, entries: Record<string, string | null | undefined>) => {
  const params = new URLSearchParams(Object.entries(entries).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return params.size ? `${path}?${params}` : path;
};

export type RepositoryStatus = "enabled" | "disabled";

/** The Repositories list on a status tab, with an ownership filter and a search. */
export function repositoriesHref(filters: { status?: RepositoryStatus | null; ownership?: OwnershipFilter | null; q?: string } = {}): string {
  return withQuery("/repositories", { status: filters.status, ownership: filters.ownership, q: filters.q });
}

/** The Assessments list on a conclusion tab. */
export function assessmentsHref(filters: { conclusion?: ConclusionFilter | null } = {}): string {
  return withQuery("/assessments", { conclusion: filters.conclusion });
}
