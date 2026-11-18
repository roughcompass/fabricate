import type { Metadata } from "next";
import Link from "next/link";
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
import { TabLink, Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { assessmentCounts } from "@/lib/catalog/catalog";
import { listSources, sourceReferenceLabel } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { isOwnershipFilter, ownershipFilterOf } from "@/lib/ownership/coverage";
import { type RepositoryOwnership, repositoryOwnership } from "@/lib/ownership/read";
import { applicationLabel } from "@/lib/ownership/records";
import { type ProfileSummary, ACTIVE_STATES, profileSummaries } from "@/lib/profiling/versions";
import { repositoriesHref } from "@/lib/web/list-filters";
import { repositoryHref, versionHref } from "@/lib/web/repository-paths";
import { reprofileSource, setSourceEnabled } from "./actions";
import styles from "./list.module.css";
import { sourceOutcome } from "./outcomes";

export const metadata: Metadata = { title: "Repositories" };

const FILTERS = { enabled: true, disabled: false } as const;

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const status = typeof query.status === "string" && Object.hasOwn(FILTERS, query.status) ? (query.status as keyof typeof FILTERS) : null;
  const ownership = isOwnershipFilter(query.ownership) ? query.ownership : null;
  const search = (param(query, "q") ?? "").trim().slice(0, 200);
  const db = getDb();
  const all = listSources(db);
  // Ownership is read once for every Repository, in a few queries, as Home's figures count it.
  const owned = repositoryOwnership(db, all.map((source) => source.id));
  const needle = search.toLowerCase();
  const searched = needle ? all.filter((source) => source.name.toLowerCase().includes(needle) || source.cloneUrl.toLowerCase().includes(needle)) : all;
  // The tabs count what the search and the ownership filter leave.
  const matching = ownership ? searched.filter((source) => ownershipFilterOf(owned.get(source.id)) === ownership) : searched;
  const sources = status ? matching.filter((source) => source.enabled === FILTERS[status]) : matching;
  const counts = assessmentCounts(db);
  const profiles = profileSummaries(db);
  const enabledCount = matching.filter((source) => source.enabled).length;
  const href = (next: keyof typeof FILTERS | null, query = search) => repositoriesHref({ status: next, ownership, q: query });
  const create = (
    <ButtonLink href="/repositories/new" variant="primary" icon="plus">
      New Repository
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader
        title="Repositories"
        description="Git repositories available to Assessments, each profiled in the background whenever it changes. Edits and disabling apply to Runs started afterward."
        secondaryActions={[
          { href: "/repositories/import", label: "Import Repositories", icon: "folder" },
          { href: "/repositories/claim", label: "Claim a Repository", icon: "user" },
        ]}
        primaryAction={create}
        alerts={<OutcomeToast outcome={sourceOutcome(db, param(query, "notice"), param(query, "source"), param(query, "count"), param(query, "failed"))} />}
      />

      <Tabs
        label="Filter Repositories"
        aside={
          <FilterBar key={`${search}|${ownership}`} action="/repositories" label="Search and filter Repositories" filtered={Boolean(search || ownership)} clearHref={repositoriesHref({ status })} keep={status ? { status } : {}}>
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
            <SearchField id="source-search" name="q" label="Search Repositories" hideLabel size="sm" placeholder="Search by name or clone URL" defaultValue={search} clearHref={href(status, "")} />
          </FilterBar>
        }
      >
        <TabLink href={href(null)} active={status === null} count={matching.length}>
          All
        </TabLink>
        <TabLink href={href("enabled")} active={status === "enabled"} count={enabledCount}>
          Enabled
        </TabLink>
        <TabLink href={href("disabled")} active={status === "disabled"} count={matching.length - enabledCount}>
          Disabled
        </TabLink>
      </Tabs>

      <Panel flush>
        {sources.length > 0 ? (
          <Table
            label="Repositories"
            head={
              <>
                <Th>Name</Th>
                <Th>Reference</Th>
                <Th>SEAL application</Th>
                <Th>Status</Th>
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
                <Td label="SEAL application">
                  <SealApplication ownership={owned.get(source.id)} />
                </Td>
                <Td label="Status">
                  <Status state={source.enabled ? "enabled" : "disabled"} />
                </Td>
                <Td label="Profile">
                  <ProfileCell sourcePublicId={source.publicId} summary={profiles.get(source.id)} enabled={source.enabled} />
                </Td>
                <Td label="Runs" align="numeric">
                  {countLabel(counts.get(source.id) ?? 0, "Run")}
                </Td>
                <Td align="actions">
                  <RowActions>
                    <Menu label={`Actions for ${source.name}`}>
                      {source.enabled && (
                        <MenuAction action={reprofileSource} fields={{ publicId: source.publicId, from: "list" }} icon="refresh">
                          Re-profile
                        </MenuAction>
                      )}
                      <MenuItem href={`/repositories/${source.publicId}/edit`} icon="edit">
                        Edit
                      </MenuItem>
                      <MenuAction action={setSourceEnabled} fields={{ publicId: source.publicId, enabled: String(!source.enabled) }} icon={source.enabled ? "slash" : "checkCircle"}>
                        {source.enabled ? "Disable" : "Enable"}
                      </MenuAction>
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
        ) : status ? (
          <EmptyState title={`No ${status} Repositories`}>{status === "disabled" ? "Every Repository is enabled." : "Enable a Repository to include it in Runs."}</EmptyState>
        ) : (
          <EmptyState
            title="No Repositories yet"
            icon="git"
            action={
              <>
                <ButtonLink href="/repositories/import" icon="folder">
                  Import Repositories
                </ButtonLink>
                {create}
              </>
            }
          >
            Register file://, https://, or ssh:// Git repositories, or import the working trees inside an allowed local directory.
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
 * A Repository's profile in the list: its current version, linked, with when
 * it was profiled; and the newest version's state when that one is queued,
 * running, or failed.
 */
function ProfileCell({ sourcePublicId, summary, enabled }: { sourcePublicId: string; summary: ProfileSummary | undefined; enabled: boolean }) {
  if (!summary) return <Secondary>{enabled ? "Queued" : "Not profiled"}</Secondary>;
  const { latest, current } = summary;
  const pending = (ACTIVE_STATES as readonly string[]).includes(latest.state);
  const newest = latest.version !== current?.version;
  return (
    <>
      {current ? (
        <>
          <Link href={versionHref(sourcePublicId, current.version)}>{`Version ${current.version}`}</Link>
          <Secondary>
            <RelativeTime value={current.profiledAt} />
          </Secondary>
        </>
      ) : (
        !pending && <Secondary>Not profiled</Secondary>
      )}
      {newest &&
        (pending ? (
          <Secondary>
            <Status state={latest.state} label={`Version ${latest.version} ${latest.state === "queued" ? "queued" : "profiling"}`} size="sm" />
          </Secondary>
        ) : (
          <Secondary>
            <Link href={versionHref(sourcePublicId, latest.version)}>
              <Status state="failed" label={`Version ${latest.version} failed`} size="sm" />
            </Link>
          </Secondary>
        ))}
    </>
  );
}
