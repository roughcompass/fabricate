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
import { Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { LIFECYCLE_STATES, type LifecycleState } from "@/lib/db/schema";
import { microfrontendCatalog } from "@/lib/onboarding/catalog";
import { mfeHref, mfeStepHref } from "./load";

export const metadata: Metadata = { title: "MFEs" };

export default async function MicrofrontendsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const lifecycle = LIFECYCLE_STATES.find((state) => state === param(query, "lifecycle") && state !== "active") ?? null;
  const search = (param(query, "q") ?? "").trim().slice(0, 200);
  const all = microfrontendCatalog(getDb(), search);
  const rows = lifecycle ? all.filter((row) => row.microfrontend.lifecycle === lifecycle) : all;
  const href = (next: LifecycleState | null, q = search) => {
    const params = new URLSearchParams({ ...(next && { lifecycle: next }), ...(q && { q }) });
    return `/onboarding/microfrontends${params.size ? `?${params}` : ""}`;
  };
  return (
    <Page>
      <PageHeader breadcrumbs={[{ href: "/onboarding/applications", label: "Web Applications" }]} title="MFEs" description="Shared microfrontend assets: each the code a CDaaS application view represents, built from one Repository. Application teams register and edit them from a Web Application's composition." />
      <Tabs
        label="Filter MFEs"
        aside={
          <FilterBar key={search} action="/onboarding/microfrontends" label="Search MFEs" filtered={Boolean(search)} clearHref={href(lifecycle, "")} keep={lifecycle ? { lifecycle } : {}}>
            <SearchField id="mfe-search" name="q" label="Search MFEs" hideLabel size="sm" placeholder="Search by name, team, SEAL ID, or CDaaS view" defaultValue={search} clearHref={href(lifecycle, "")} />
          </FilterBar>
        }
      >
        <TabLink href={href(null)} active={lifecycle === null} count={all.length}>
          All
        </TabLink>
        {LIFECYCLE_STATES.filter((state) => state !== "active").map((state) => (
          <TabLink key={state} href={href(state)} active={lifecycle === state} count={all.filter((row) => row.microfrontend.lifecycle === state).length}>
            <Status state={state} size="sm" />
          </TabLink>
        ))}
      </Tabs>
      <Panel flush>
        {rows.length > 0 ? (
          <Table
            label="MFEs"
            head={
              <>
                <Th>Name</Th>
                <Th>Built from</Th>
                <Th>CDaaS view</Th>
                <Th>Lifecycle</Th>
                <Th align="numeric">Used by</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {rows.map(({ microfrontend: mfe, source, uses, draft }) => (
              <tr key={mfe.publicId}>
                <Td label="Name">
                  <Primary>
                    <Link href={mfeHref(mfe.publicId)}>{mfe.name}</Link>
                  </Primary>
                  <Secondary>{[mfe.ownerTeam ? `Owned by ${mfe.ownerTeam}` : "No owning team yet", mfe.sealId && `SEAL ID ${mfe.sealId}`, draft && "Draft open"].filter(Boolean).join(" · ")}</Secondary>
                </Td>
                <Td label="Built from">{source ? <>{source.repository}{source.path && <Secondary mono>{source.path}</Secondary>}</> : <Secondary>Not submitted yet</Secondary>}</Td>
                <Td label="CDaaS view">{mfe.cdaasAppId ? <Tag label="CDaaS view">{`${mfe.cdaasAppId}/${mfe.cdaasViewId}`}</Tag> : <Secondary>Not named</Secondary>}</Td>
                <Td label="Lifecycle">
                  <Status state={mfe.lifecycle} />
                </Td>
                <Td label="Used by" align="numeric">
                  {countLabel(uses, "Application")}
                </Td>
                <Td align="actions">
                  <RowActions>
                    <Menu label={`Actions for ${mfe.name}`}>
                      <MenuItem href={mfeHref(mfe.publicId)} icon="eye">
                        Open
                      </MenuItem>
                      {draft && (
                        <MenuItem href={mfeStepHref(mfe.publicId, "identity")} icon="edit">
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
          <EmptyState title="No matching MFEs" icon="search">{`No MFE name, team, SEAL ID, or CDaaS view contains “${search}”.`}</EmptyState>
        ) : lifecycle ? (
          <EmptyState title={`No ${lifecycle} MFEs`}>An MFE becomes Ready when its submitted revision is complete and CDaaS confirms its view.</EmptyState>
        ) : (
          <EmptyState title="No MFEs yet" icon="layers" action={<ButtonLink href="/onboarding/applications">Open Web Applications</ButtonLink>}>
            Register an MFE from a Web Application&apos;s composition step, where the Applications that use it can find it again.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
