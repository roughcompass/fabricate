import type { Metadata } from "next";
import Link from "next/link";
import { ProgressPoller } from "@/components/progress-poller";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Menu, MenuAction, MenuItem } from "@/components/ui/menu";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param, searchTerm } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Status, humanize } from "@/components/ui/status";
import { SearchField } from "@/components/ui/search-field";
import { RelativeTime } from "@/components/ui/relative-time";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { runCounts } from "@/lib/repositories/registration";
import { listRepositories, repositoryReferenceLabel } from "@/lib/repositories/repository-records";
import { getDb } from "@/lib/db/client";
import { type ProfileSummary, ACTIVE_STATES, profileSummaries, profilingActivity } from "@/lib/profiling/versions";
import { repositoriesHref } from "@/lib/web/list-filters";
import { reprofileRepository } from "./actions";
import styles from "./list.module.css";
import { repositoryOutcome } from "./outcomes";
import { routes } from "@/lib/web/routes";

export const metadata: Metadata = { title: "Repositories" };

export default async function RepositoriesPage({ searchParams }: PageProps<"/repositories">) {
  const query = await searchParams;
  const search = searchTerm(query);
  const db = getDb();
  const all = listRepositories(db);
  const needle = search.toLowerCase();
  const repositories = needle ? all.filter((repository) => repository.name.toLowerCase().includes(needle) || repository.cloneUrl.toLowerCase().includes(needle)) : all;
  const counts = runCounts(db);
  const profiles = profileSummaries(db);
  const activity = profilingActivity(db);
  const busy = activity.profiling + activity.queued > 0;
  const create = (
    <ButtonLink href="/repositories/new" variant="primary" icon="plus">
      New Repository
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader
        title="Repositories"
        description="Git repositories available to Assessments, each profiled in the background whenever it changes. Edits apply to Runs started afterward."
        secondaryActions={[
          { href: "/repositories/bulk", label: "Add in bulk", icon: "layers" },
        ]}
        primaryAction={create}
        alerts={<OutcomeToast outcome={repositoryOutcome(db, param(query, "notice"), param(query, "source"), param(query, "count"))} />}
      />

      <div className={styles.toolbar}>
        <p className={styles.count}>{countLabel(repositories.length, "Repository", "Repositories")}{repositories.length !== all.length ? ` of ${all.length}` : ""}</p>
        <FilterBar key={search} action="/repositories" label="Search Repositories" filtered={Boolean(search)} clearHref={repositoriesHref()}>
          <SearchField id="source-search" name="q" label="Search Repositories" hideLabel size="sm" placeholder="Search by name or clone URL" defaultValue={search} clearHref={repositoriesHref()} />
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

      <Panel flush>
        {repositories.length > 0 ? (
          <Table
            label="Repositories"
            head={
              <>
                <Th>Name</Th>
                <Th>Reference</Th>
                <Th>Profile</Th>
                <Th align="numeric">Runs</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {repositories.map((repository) => (
              <tr key={repository.publicId} id={repository.publicId}>
                <Td label="Name">
                  <Primary>
                    <Link href={routes.repository(repository.publicId)}>{repository.name}</Link>
                  </Primary>
                  <Secondary>
                    <span className={styles.cloneUrl}>
                      <Tag copy label="clone URL">
                        {repository.cloneUrl}
                      </Tag>
                    </span>
                  </Secondary>
                </Td>
                <Td label="Reference">{repository.gitRef ? <Tag>{repository.gitRef}</Tag> : <Secondary>{humanize(repositoryReferenceLabel(repository))}</Secondary>}</Td>
                <Td label="Profile">
                  <ProfileCell repositoryPublicId={repository.publicId} summary={profiles.get(repository.id)} />
                </Td>
                <Td label="Runs" align="numeric">
                  {countLabel(counts.get(repository.id) ?? 0, "Run")}
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
        ) : search ? (
          <EmptyState title="No matching Repositories" icon="search">{`No Repository name or clone URL contains “${search}”.`}</EmptyState>
        ) : (
          <EmptyState
            title="No Repositories yet"
            icon="git"
            action={
              <>
                <ButtonLink href="/repositories/bulk" icon="layers">
                  Add in bulk
                </ButtonLink>
                {create}
              </>
            }
          >
            Register file://, https://, or ssh:// Git repositories one at a time, or paste many clone URLs at once.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}

/**
 * A Repository's profile in the list. While a version is being profiled or
 * waits its turn, that leads, with a pulsing indicator for profiling; the
 * current version, linked, and when it was profiled follow. A newest
 * version that failed is marked under the current one.
 */
function ProfileCell({ repositoryPublicId, summary }: { repositoryPublicId: string; summary: ProfileSummary | undefined }) {
  if (!summary) return <Secondary>Queued</Secondary>;
  const { latest, current } = summary;
  const pending = (ACTIVE_STATES as readonly string[]).includes(latest.state);
  // The newest version is newer than the current one, and failed.
  const failed = !pending && !latest.profiled && (!current || latest.version > current.version);
  // The current Profile, by its version, and when it was written.
  const currentLink = current && <Link href={routes.repositoryVersion(repositoryPublicId, current.version)}>{`Version ${current.version}`}</Link>;
  const currentRows = current && (
    <>
      {currentLink}
      <Secondary>
        <RelativeTime value={current.profiledAt} />
      </Secondary>
    </>
  );
  if (pending) {
    return (
      <span data-profiling={latest.state === "queued" ? "queued" : "profiling"}>
        <Status state={latest.state} label={latest.state === "queued" ? `Version ${latest.version} queued` : `Profiling version ${latest.version}`} />
        {current && (
          <>
            <Secondary>{currentLink}</Secondary>
            <Secondary>
              <RelativeTime value={current.profiledAt} />
            </Secondary>
          </>
        )}
      </span>
    );
  }
  if (!current) {
    return (
      <Link href={routes.repositoryVersion(repositoryPublicId, latest.version)}>
        <Status state="failed" label={`Version ${latest.version} failed`} />
      </Link>
    );
  }
  return (
    <>
      {currentRows}
      {failed && (
        <Secondary>
          <Link href={routes.repositoryVersion(repositoryPublicId, latest.version)}>
            <Status state="failed" label={`Version ${latest.version} failed`} size="sm" />
          </Link>
        </Secondary>
      )}
    </>
  );
}
