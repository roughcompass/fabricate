import type { Metadata } from "next";
import Link from "next/link";
import { ProgressPoller } from "@/components/progress-poller";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Menu, MenuAction, MenuItem } from "@/components/ui/menu";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Status, humanize } from "@/components/ui/status";
import { SearchField } from "@/components/ui/search-field";
import { Select } from "@/components/ui/form";
import { RelativeTime } from "@/components/ui/relative-time";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { assessmentCounts } from "@/lib/catalog/catalog";
import { listSources, sourceReferenceLabel } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { isOwnershipFilter, ownershipFilterOf } from "@/lib/ownership/coverage";
import { type RepositoryOwnership, repositoryOwnership } from "@/lib/ownership/read";
import { applicationLabel } from "@/lib/ownership/records";
import { type ProfileSummary, ACTIVE_STATES, profileSummaries, profilingActivity } from "@/lib/profiling/versions";
import { repositoriesHref } from "@/lib/web/list-filters";
import { repositoryHref, settingsHref, versionHref } from "@/lib/web/repository-paths";
import { reprofileSource } from "./actions";
import styles from "./list.module.css";
import { sourceOutcome } from "./outcomes";

export const metadata: Metadata = { title: "Repositories" };

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const ownership = isOwnershipFilter(query.ownership) ? query.ownership : null;
  const search = (param(query, "q") ?? "").trim().slice(0, 200);
  const db = getDb();
  const all = listSources(db);
  // Ownership is read once for every Repository, in a few queries, as Home's figures count it.
  const owned = repositoryOwnership(db, all.map((source) => source.id));
  const needle = search.toLowerCase();
  const searched = needle ? all.filter((source) => source.name.toLowerCase().includes(needle) || source.cloneUrl.toLowerCase().includes(needle)) : all;
  const sources = ownership ? searched.filter((source) => ownershipFilterOf(owned.get(source.id)) === ownership) : searched;
  const counts = assessmentCounts(db);
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
          { href: "/repositories/claim", label: "Claim a Repository", icon: "user" },
        ]}
        primaryAction={create}
        alerts={<OutcomeToast outcome={sourceOutcome(db, param(query, "notice"), param(query, "source"), param(query, "count"))} />}
      />

      <div className={styles.toolbar}>
        <p className={styles.count}>{countLabel(sources.length, "Repository", "Repositories")}{sources.length !== all.length ? ` of ${all.length}` : ""}</p>
        <FilterBar key={`${search}|${ownership}`} action="/repositories" label="Search and filter Repositories" filtered={Boolean(search || ownership)} clearHref={repositoriesHref()}>
          <Select
            id="source-ownership"
            name="ownership"
            label="Ownership"
            size="sm"
            defaultValue={ownership ?? ""}
            options={[
              { value: "", label: "Any ownership" },
              { value: "claimed", label: "Claimed" },
              { value: "unclaimed", label: "Unclaimed" },
            ]}
          />
          <SearchField id="source-search" name="q" label="Search Repositories" hideLabel size="sm" placeholder="Search by name or clone URL" defaultValue={search} clearHref={repositoriesHref({ ownership })} />
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
        {sources.length > 0 ? (
          <Table
            label="Repositories"
            head={
              <>
                <Th>Name</Th>
                <Th>Reference</Th>
                <Th>SEAL</Th>
                <Th>Profile</Th>
                <Th align="numeric">Runs</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {sources.map((source) => (
              <tr key={source.publicId} id={source.publicId}>
                <Td label="Name">
                  <Primary>
                    <Link href={repositoryHref(source.publicId)}>{source.name}</Link>
                  </Primary>
                  <Secondary>
                    <span className={styles.cloneUrl}>
                      <Tag copy label="clone URL">
                        {source.cloneUrl}
                      </Tag>
                    </span>
                  </Secondary>
                </Td>
                <Td label="Reference">{source.gitRef ? <Tag>{source.gitRef}</Tag> : <Secondary>{humanize(sourceReferenceLabel(source))}</Secondary>}</Td>
                <Td label="SEAL">
                  <SealApplication ownership={owned.get(source.id)} />
                </Td>
                <Td label="Profile">
                  <ProfileCell sourcePublicId={source.publicId} summary={profiles.get(source.id)} />
                </Td>
                <Td label="Runs" align="numeric">
                  {countLabel(counts.get(source.id) ?? 0, "Run")}
                </Td>
                <Td align="actions">
                  <RowActions>
                    <Menu label={`Actions for ${source.name}`}>
                      <MenuAction action={reprofileSource} fields={{ publicId: source.publicId, from: "list" }} icon="refresh">
                        Re-profile
                      </MenuAction>
                      <MenuItem href={settingsHref(source.publicId)} icon="settings">
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
        ) : ownership ? (
          <EmptyState title={`No ${ownership} Repositories`}>{ownership === "unclaimed" ? "Every Repository listed here has a SEAL application." : "Claim a Repository to record the SEAL application it belongs to."}</EmptyState>
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

/** A Repository's effective SEAL application, marked when people's claims disagree, or "Unclaimed". */
function SealApplication({ ownership }: { ownership: RepositoryOwnership | undefined }) {
  const application = ownership?.application;
  if (!application?.value) return <Secondary>Unclaimed</Secondary>;
  return (
    <>
      {applicationLabel(application.value)}
      {application.conflict && (
        <Secondary>
          <Status state="conflicting" label="In conflict" size="sm" />
        </Secondary>
      )}
    </>
  );
}

/**
 * A Repository's profile in the list. While a version is being profiled or
 * waits its turn, that leads, with a pulsing indicator for profiling; the
 * current version, linked, and when it was profiled follow. A newest
 * version that failed is marked under the current one.
 */
function ProfileCell({ sourcePublicId, summary }: { sourcePublicId: string; summary: ProfileSummary | undefined }) {
  if (!summary) return <Secondary>Queued</Secondary>;
  const { latest, current } = summary;
  const pending = (ACTIVE_STATES as readonly string[]).includes(latest.state);
  const failed = !pending && latest.version !== current?.version;
  // The current version and when it was profiled, each on its own row.
  const currentRows = current && (
    <>
      <Link href={versionHref(sourcePublicId, current.version)}>{`Version ${current.version}`}</Link>
      <Secondary>
        <RelativeTime value={current.profiledAt} />
      </Secondary>
    </>
  );
  if (pending) {
    return (
      <span data-profiling={latest.state === "queued" ? "queued" : "profiling"}>
        <Status state={latest.state} label={latest.state === "queued" ? `Version ${latest.version} queued` : `Profiling version ${latest.version}`} />
        {/* A version writes its Profile just before its Run finishes; until then it's shown once, as profiling. */}
        {current && current.version !== latest.version && (
          <>
            <Secondary>
              <Link href={versionHref(sourcePublicId, current.version)}>{`Version ${current.version}`}</Link>
            </Secondary>
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
      <Link href={versionHref(sourcePublicId, latest.version)}>
        <Status state="failed" label={`Version ${latest.version} failed`} />
      </Link>
    );
  }
  return (
    <>
      {currentRows}
      {failed && (
        <Secondary>
          <Link href={versionHref(sourcePublicId, latest.version)}>
            <Status state="failed" label={`Version ${latest.version} failed`} size="sm" />
          </Link>
        </Secondary>
      )}
    </>
  );
}
