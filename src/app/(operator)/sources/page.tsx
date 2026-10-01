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

export const metadata: Metadata = { title: "Sources" };

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
    return `/sources${params.size ? `?${params}` : ""}`;
  };
  const create = (
    <ButtonLink href="/sources/new" variant="primary" icon="plus">
      New Source
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader
        title="Sources"
        description="Git repositories available to Initiatives. Edits and disabling apply to Assessments started afterward."
        secondaryActions={[{ href: "/sources/import", label: "Import directory", icon: "folder" }]}
        primaryAction={create}
        alerts={<OutcomeToast outcome={sourceOutcome(db, param(query, "notice"), param(query, "source"), param(query, "count"), param(query, "failed"))} />}
      />

      <Tabs
        label="Filter Sources"
        aside={
          <FilterBar key={search} action="/sources" label="Search Sources" filtered={Boolean(search)} clearHref={href(status, "")} keep={status ? { status } : {}}>
            <SearchField id="source-search" name="q" label="Search Sources" hideLabel size="sm" placeholder="Search by name or clone URL" defaultValue={search} clearHref={href(status, "")} />
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
            label="Repository Sources"
            head={
              <>
                <Th>Name</Th>
                <Th>Reference</Th>
                <Th>Status</Th>
                <Th align="numeric">Assessments</Th>
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
                    <Link href={`/sources/${source.publicId}/edit`}>{source.name}</Link>
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
                <Td label="Assessments" align="numeric">
                  {countLabel(counts.get(source.id) ?? 0, "Assessment")}
                </Td>
                <Td align="actions">
                  <RowActions>
                    <Menu label={`Actions for ${source.name}`}>
                      <MenuItem href={`/sources/${source.publicId}/edit`} icon="edit">
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
          <EmptyState title="No matching Sources" icon="search">{`No Source name or clone URL contains “${search}”.`}</EmptyState>
        ) : status ? (
          <EmptyState title={`No ${status} Sources`}>{status === "disabled" ? "Every Source is enabled." : "Enable a Source to include it in Assessments."}</EmptyState>
        ) : (
          <EmptyState
            title="No Sources yet"
            icon="git"
            action={
              <>
                <ButtonLink href="/sources/import" icon="folder">
                  Import directory
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
