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
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { assessmentCounts } from "@/lib/catalog/catalog";
import { listSources, sourceReferenceLabel } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { setSourceEnabled } from "./actions";
import { sourceOutcome } from "./outcomes";

export const metadata: Metadata = { title: "Repositories" };

const FILTERS = { enabled: true, disabled: false } as const;

export default async function SourcesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const status = typeof query.status === "string" && Object.hasOwn(FILTERS, query.status) ? (query.status as keyof typeof FILTERS) : null;
  const search = (param(query, "q") ?? "").trim().slice(0, 200);
  const db = getDb();
  const all = listSources(db);
  const needle = search.toLowerCase();
  const matching = needle ? all.filter((source) => source.name.toLowerCase().includes(needle) || source.cloneUrl.toLowerCase().includes(needle)) : all;
  const sources = status ? matching.filter((source) => source.enabled === FILTERS[status]) : matching;
  const counts = assessmentCounts(db);
  const enabledCount = matching.filter((source) => source.enabled).length;
  const href = (next: keyof typeof FILTERS | null, query = search) => {
    const params = new URLSearchParams({ ...(next && { status: next }), ...(query && { q: query }) });
    return `/repositories${params.size ? `?${params}` : ""}`;
  };
  const create = (
    <ButtonLink href="/repositories/new" variant="primary" icon="plus">
      New Repository
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader
        title="Repositories"
        description="Git repositories available to Assessments. Edits and disabling apply to Runs started afterward."
        secondaryActions={[{ href: "/repositories/import", label: "Import Repositories", icon: "folder" }]}
        primaryAction={create}
        alerts={<OutcomeToast outcome={sourceOutcome(db, param(query, "notice"), param(query, "source"), param(query, "count"), param(query, "failed"))} />}
      />

      <Tabs
        label="Filter Repositories"
        aside={
          <FilterBar key={search} action="/repositories" label="Search Repositories" filtered={Boolean(search)} clearHref={href(status, "")} keep={status ? { status } : {}}>
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
                <Th>Status</Th>
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
                    <Link href={`/repositories/${source.publicId}/edit`}>{source.name}</Link>
                  </Primary>
                  <Secondary>
                    <Tag copy label="clone URL">
                      {source.cloneUrl}
                    </Tag>
                  </Secondary>
                </Td>
                <Td label="Reference">{source.gitRef ? <Tag>{source.gitRef}</Tag> : <Secondary>{humanize(sourceReferenceLabel(source))}</Secondary>}</Td>
                <Td label="Status">
                  <Status state={source.enabled ? "enabled" : "disabled"} />
                </Td>
                <Td label="Runs" align="numeric">
                  {countLabel(counts.get(source.id) ?? 0, "Run")}
                </Td>
                <Td align="actions">
                  <RowActions>
                    <Menu label={`Actions for ${source.name}`}>
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
