import type { RecipeState } from "@/lib/catalog/updates";
import type { ConclusionFilter } from "@/lib/evaluations/conclusions";
import { withQuery } from "./query";
import { routes } from "./routes";

/**
 * Addresses of the lists Home's figures open, with their filters
 * (page-patterns spec, "The Repositories and Assessments lists filter what
 * Home counts"). The lists build their own tab and filter links here too, so
 * a figure and the list it opens always agree on the parameters.
 */

/** The Repositories list with a search, and filtered to a recipe state, as System status's counts open it. */
export function repositoriesHref(filters: { q?: string; recipe?: RecipeState | null } = {}): string {
  return withQuery(routes.repositories, { q: filters.q, recipe: filters.recipe });
}

/** The Assessments list on a conclusion tab. */
export function assessmentsHref(filters: { conclusion?: ConclusionFilter | null } = {}): string {
  return withQuery(routes.assessments, { conclusion: filters.conclusion });
}
