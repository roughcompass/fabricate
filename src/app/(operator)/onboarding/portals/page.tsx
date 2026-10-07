import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Menu, MenuItem } from "@/components/ui/menu";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { SearchField } from "@/components/ui/search-field";
import { Status } from "@/components/ui/status";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { getDb } from "@/lib/db/client";
import { LIFECYCLE_STATES, type LifecycleState } from "@/lib/db/schema";
import { portalCatalog } from "@/lib/onboarding/catalog";
import { portalHref, stepHref } from "./load";

export const metadata: Metadata = { title: "Portals" };

export default async function PortalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const lifecycle = LIFECYCLE_STATES.find((state) => state === param(query, "lifecycle")) ?? null;
  const search = (param(query, "q") ?? "").trim().slice(0, 200);
  const all = portalCatalog(getDb(), search);
  const rows = lifecycle ? all.filter((row) => row.portal.lifecycle === lifecycle) : all;
  const href = (next: LifecycleState | null, q = search) => {
    const params = new URLSearchParams({ ...(next && { lifecycle: next }), ...(q && { q }) });
    return `/onboarding/portals${params.size ? `?${params}` : ""}`;
  };
  const create = (
    <ButtonLink href="/onboarding/portals/new" variant="primary" icon="plus">
      New Portal
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader title="Portals" description="Portals onboarded as configuration: the environments each enables, its menu, its default routes, and the placements its team reviews." primaryAction={create} />
      <Tabs
        label="Filter Portals"
        aside={
          <FilterBar key={search} action="/onboarding/portals" label="Search Portals" filtered={Boolean(search)} clearHref={href(lifecycle, "")} keep={lifecycle ? { lifecycle } : {}}>
            <SearchField id="portal-search" name="q" label="Search Portals" hideLabel size="sm" placeholder="Search by name, team, or SEAL ID" defaultValue={search} clearHref={href(lifecycle, "")} />
          </FilterBar>
        }
      >
        <TabLink href={href(null)} active={lifecycle === null} count={all.length}>
          All
        </TabLink>
        {LIFECYCLE_STATES.map((state) => (
          <TabLink key={state} href={href(state)} active={lifecycle === state} count={all.filter((row) => row.portal.lifecycle === state).length}>
            <Status state={state} size="sm" />
          </TabLink>
        ))}
      </Tabs>
      <Panel flush>
        {rows.length > 0 ? (
          <Table
            label="Portals"
            head={
              <>
                <Th>Name</Th>
                <Th>Owner</Th>
                <Th>Lifecycle</Th>
                <Th>Environments</Th>
                <Th align="numeric">Placements</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {rows.map(({ portal, environments, placements, revision, draft }) => (
              <tr key={portal.publicId}>
                <Td label="Name">
                  <Primary>
                    <Link href={portalHref(portal.publicId)}>{portal.label}</Link>
                  </Primary>
                  <Secondary>{[portal.sealId && `SEAL ID ${portal.sealId}`, revision ? `Revision ${revision}` : "Not onboarded yet", draft && "Draft open"].filter(Boolean).join(" · ")}</Secondary>
                </Td>
                <Td label="Owner">{portal.ownerTeam ?? <Secondary>Not stated</Secondary>}</Td>
                <Td label="Lifecycle">
                  <Status state={portal.lifecycle} />
                </Td>
                <Td label="Environments">{environments.length > 0 ? environments.map((environment) => environment.toUpperCase()).join(", ") : <Secondary>None yet</Secondary>}</Td>
                <Td label="Placements" align="numeric">
                  {countLabel(placements, "approved placement")}
                </Td>
                <Td align="actions">
                  <RowActions>
                    <Menu label={`Actions for ${portal.label}`}>
                      <MenuItem href={portalHref(portal.publicId)} icon="eye">
                        Open
                      </MenuItem>
                      {draft && (
                        <MenuItem href={stepHref(portal.publicId, "identity")} icon="edit">
                          Edit Draft
                        </MenuItem>
                      )}
                    </Menu>
                  </RowActions>
                </Td>
              </tr>
            ))}
          </Table>
        ) : search ? (
          <EmptyState title="No matching Portals" icon="search">{`No Portal name, team, or SEAL ID contains “${search}”.`}</EmptyState>
        ) : lifecycle ? (
          <EmptyState title={`No ${lifecycle} Portals`}>Portals move from Draft to Ready when a revision is submitted, and to Active when their owner activates one.</EmptyState>
        ) : (
          <EmptyState title="No Portals yet" icon="network" action={create}>
            Onboard a Portal as configuration: its owning team, the environments it enables, and its menu. Applications then ask to be placed in it.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
