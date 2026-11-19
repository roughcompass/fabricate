import type { Metadata } from "next";
import Link from "next/link";
import { ProgressPoller } from "@/components/progress-poller";
import { IndexTemplate } from "@/components/templates/index-template";
import { ButtonLink } from "@/components/ui/button";
import { countLabel, formatNumber } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Menu, MenuAction, MenuItem } from "@/components/ui/menu";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { oneOf, pageNumber, param, searchTerm } from "@/lib/web/query";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { Status } from "@/components/ui/status";
import { SearchField } from "@/components/ui/search-field";
import { RelativeTime } from "@/components/ui/relative-time";
import { Primary, RowActions, Table, Td, Th } from "@/components/ui/table";
import { Select } from "@/components/ui/form";
import { RECIPE_STATES, type RecipeState, recipeStates } from "@/lib/catalog/updates";
import { getConfig } from "@/lib/config";
import { PRODUCT } from "@/lib/product";
import { listRepositories } from "@/lib/repositories/repository-records";
import { getDb } from "@/lib/db/client";
import { type ProfileSummary, ACTIVE_STATES, profileSummaries, profilingActivity } from "@/lib/profiling/versions";
import { repositoriesHref } from "@/lib/web/list-filters";
import { reprofileRepository } from "./actions";
import styles from "./list.module.css";
import { repositoryOutcome } from "./outcomes";
import { routes } from "@/lib/web/routes";

export const metadata: Metadata = { title: "Repositories" };

/** Each recipe state as the filter names it (System status counts the same states). */
const RECIPE_LABELS: Record<RecipeState, string> = { current: "On the current recipe", waiting: "Waiting to be surveyed", failed: "Failed its newest survey" };
const RECIPE_OPTIONS = [{ value: "", label: "Any recipe" }, ...RECIPE_STATES.map((state) => ({ value: state, label: RECIPE_LABELS[state] }))];

/** Rows per page (page-patterns spec, "Long lists are paged"). */
const PAGE_SIZE = 50;

/** The count beside the results: "Showing 1–50 of 500 Repositories", and with a filter, how many there are in all. */
function showing(page: number, shown: number, matching: number, total: number | null): string {
  const all = total === null ? "" : ` (${formatNumber(total)} in all)`;
  if (matching === 0) return total === null ? "No Repositories" : `None of ${countLabel(total, "Repository", "Repositories")} match`;
  const start = (page - 1) * PAGE_SIZE + 1;
  const noun = total === null ? countLabel(matching, "Repository", "Repositories") : countLabel(matching, "matching Repository", "matching Repositories");
  return `Showing ${formatNumber(start)}–${formatNumber(start + shown - 1)} of ${noun}${all}`;
}

export default async function RepositoriesPage({ searchParams }: PageProps<"/repositories">) {
  const query = await searchParams;
  const search = searchTerm(query);
  const recipe = oneOf(query, "recipe", RECIPE_STATES) ?? null;
  const db = getDb();
  const all = listRepositories(db);
  const needle = search.toLowerCase();
  const states = recipe ? recipeStates(db, getConfig()) : null;
  const repositories = all.filter((repository) => (!needle || repository.name.toLowerCase().includes(needle) || repository.cloneUrl.toLowerCase().includes(needle)) && (!states || states.get(repository.id) === recipe));
  const filtered = Boolean(search || recipe);
  const { page, pages } = pageNumber(param(query, "page"), repositories.length, PAGE_SIZE);
  const shown = repositories.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const profiles = profileSummaries(db);
  const activity = profilingActivity(db);
  const busy = activity.profiling + activity.queued > 0;
  const create = (
    <ButtonLink href="/repositories/new" variant="primary" icon="plus">
      New Repository
    </ButtonLink>
  );

  return (
    <IndexTemplate
      header={{
        title: "Repositories",
        description: `Every Git repository registered with the ${PRODUCT.name}, and its newest Profile.`,
        secondaryActions: [{ href: "/repositories/bulk", label: "Add Repositories", icon: "layers" }],
        primaryAction: create,
      }}
      alerts={<OutcomeToast outcome={repositoryOutcome(db, param(query, "notice"), param(query, "source"), param(query, "count"))} />}
      filters={
        <>
          <div className={styles.toolbar}>
            <p className={styles.count} role="status">
              {showing(page, shown.length, repositories.length, filtered ? all.length : null)}
            </p>
            <FilterBar key={`${search}:${recipe}`} action="/repositories" label="Search Repositories" filtered={filtered} clearHref={repositoriesHref()}>
              <SearchField id="source-search" name="q" label="Search Repositories" hideLabel size="sm" placeholder="Search by name or clone URL" defaultValue={search} clearHref={repositoriesHref({ recipe })} />
              <Select id="recipe-filter" name="recipe" label="Recipe" hideLabel size="sm" defaultValue={recipe ?? ""} options={RECIPE_OPTIONS} />
            </FilterBar>
          </div>
          {busy && (
            <>
              {/* Refreshes the list as each version starts and finishes. */}
              <ProgressPoller url="/api/repositories/profiling" version={activity.version} intervalMs={3_000} />
              <p className={styles.activity} role="status" data-profiling-activity="">
                {activity.profiling > 0 && <Status state="analyzing" label={`Profiling ${countLabel(activity.profiling, "Repository", "Repositories")}`} />}
                {activity.queued > 0 && <Status state="queued" label={`${activity.queued} queued`} />}
              </p>
            </>
          )}
        </>
      }
      empty={
        all.length === 0
          ? {
              title: "No Repositories yet",
              icon: "git",
              action: (
                <>
                  <ButtonLink href="/repositories/bulk" icon="layers">
                    Add Repositories
                  </ButtonLink>
                  {create}
                </>
              ),
              children: "Register file://, https://, or ssh:// Git repositories one at a time, or paste many clone URLs at once.",
            }
          : undefined
      }
      pagination={<Pagination label="Repositories pages" page={page} pages={pages} href={(number) => repositoriesHref({ q: search || undefined, recipe, page: number })} />}
    >
      <Panel flush>
        {repositories.length > 0 ? (
          <Table
            label="Repositories"
            head={
              <>
                <Th>Name</Th>
                <Th>Profile</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {shown.map((repository) => (
              <tr key={repository.publicId} id={repository.publicId}>
                <Td label="Name">
                  {/* One line: the clone URL is in the name's tooltip and on the Repository's page. */}
                  <Primary>
                    <Link href={routes.repository(repository.publicId)} title={repository.cloneUrl}>
                      {repository.name}
                    </Link>
                  </Primary>
                </Td>
                <Td label="Profile">
                  <ProfileCell repositoryPublicId={repository.publicId} name={repository.name} summary={profiles.get(repository.id)} />
                </Td>
                <Td align="actions">
                  <RowActions>
                    <Menu label={`Actions for ${repository.name}`}>
                      <MenuAction action={reprofileRepository} fields={{ publicId: repository.publicId, from: "list" }} icon="refresh">
                        Re-profile
                      </MenuAction>
                      <MenuItem href={routes.repositorySettings(repository.publicId)} icon="settings">
                        Settings
                      </MenuItem>
                    </Menu>
                  </RowActions>
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          // The filter bar above offers Clear filters.
          <EmptyState title="No matching Repositories" icon="search">
            {search ? `No Repository name or clone URL contains “${search}”${recipe ? ` among those ${RECIPE_LABELS[recipe].toLowerCase()}` : ""}.` : `No Repository is ${RECIPE_LABELS[recipe ?? "current"].toLowerCase()}.`}
          </EmptyState>
        )}
      </Panel>
    </IndexTemplate>
  );
}

/**
 * A Repository's profile in the list, on one line. While a version is being
 * profiled or waits its turn, that leads, with a pulsing indicator for
 * profiling, then the current version; otherwise the current version, linked,
 * and when it was profiled. A newest version that failed follows the current
 * one.
 */
function ProfileCell({ repositoryPublicId, name, summary }: { repositoryPublicId: string; name: string; summary: ProfileSummary | undefined }) {
  if (!summary) return <span className={styles.muted}>Queued</span>;
  const { latest, current } = summary;
  const pending = (ACTIVE_STATES as readonly string[]).includes(latest.state);
  // The newest version is newer than the current one, and failed.
  const failed = !pending && !latest.profiled && (!current || latest.version > current.version);
  const currentLink = current && (
    <Link href={routes.repositoryVersion(repositoryPublicId, current.version)} aria-label={`${name}, version ${current.version}`}>
      {`Version ${current.version}`}
    </Link>
  );
  const failedLink = (
    <Link href={routes.repositoryVersion(repositoryPublicId, latest.version)} aria-label={`${name}, version ${latest.version}, failed`}>
      <Status state="failed" label={`Version ${latest.version} failed`} size="sm" />
    </Link>
  );
  return (
    <span className={styles.profile} data-profiling={pending ? (latest.state === "queued" ? "queued" : "profiling") : undefined}>
      {pending && <Status state={latest.state} label={latest.state === "queued" ? `Version ${latest.version} queued` : `Profiling version ${latest.version}`} />}
      {current && (
        <span className={pending ? styles.muted : undefined}>
          {currentLink}
          <span className={styles.muted}>
            {" · "}
            <RelativeTime value={current.profiledAt} />
          </span>
        </span>
      )}
      {failed && failedLink}
    </span>
  );
}
