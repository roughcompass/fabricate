import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Menu, MenuItem } from "@/components/ui/menu";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/form";
import { SearchField } from "@/components/ui/search-field";
import { Status } from "@/components/ui/status";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { countLabel } from "@/components/ui/count";
import { getDb } from "@/lib/db/client";
import { LIFECYCLE_STATES, type LifecycleState } from "@/lib/db/schema";
import { applicationName } from "@/lib/onboarding/applications";
import { applicationCatalog } from "@/lib/onboarding/catalog";
import { RENDERING_MODE_LABELS } from "@/lib/onboarding/documents";
import { type PlacementFilter, isPlacementFilter, onboardingCatalogHref } from "@/lib/web/list-filters";
import { applicationHref, applicationStepHref } from "./load";

export const metadata: Metadata = { title: "Web Applications" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const lifecycle = LIFECYCLE_STATES.find((state) => state === param(query, "lifecycle") && state !== "active") ?? null;
  const placement = isPlacementFilter(param(query, "placement")) ? (param(query, "placement") as PlacementFilter) : null;
  const search = (param(query, "q") ?? "").trim().slice(0, 200);
  const searched = applicationCatalog(getDb(), search);
  // Placed means a Portal has an active route for it; Home's Placed Web Applications counts the same routes. The tabs count what the search and this filter leave.
  const all = placement ? searched.filter((row) => row.portals > 0 === (placement === "placed")) : searched;
  const rows = lifecycle ? all.filter((row) => row.application.lifecycle === lifecycle) : all;
  const href = (next: LifecycleState | null, q = search) => onboardingCatalogHref("applications", { lifecycle: next, placement, q });
  const create = (
    <ButtonLink href="/onboarding/applications/new" variant="primary" icon="plus">
      New Web Application
    </ButtonLink>
  );
  return (
    <Page>
      <PageHeader
        title="Web Applications"
        description="Route-level experiences: each launched from a shared MFE or an external endpoint, composed from shared MFEs, and placed in any number of Portals."
        primaryAction={create}
        extraActions={<ButtonLink href="/onboarding/microfrontends" icon="layers">Shared MFEs</ButtonLink>}
      />
      <Tabs
        label="Filter Web Applications"
        aside={
          <FilterBar key={`${search}|${placement}`} action="/onboarding/applications" label="Search and filter Web Applications" filtered={Boolean(search || placement)} clearHref={onboardingCatalogHref("applications", { lifecycle })} keep={lifecycle ? { lifecycle } : {}}>
            <Select
              id="application-placement"
              name="placement"
              label="Placement"
              size="sm"
              defaultValue={placement ?? ""}
              options={[
                { value: "", label: "Any placement" },
                { value: "placed", label: "Placed in a Portal" },
                { value: "unplaced", label: "Not placed" },
              ]}
            />
            <SearchField id="application-search" name="q" label="Search Web Applications" hideLabel size="sm" placeholder="Search by name, team, or SEAL ID" defaultValue={search} clearHref={href(lifecycle, "")} />
          </FilterBar>
        }
      >
        <TabLink href={href(null)} active={lifecycle === null} count={all.length}>
          All
        </TabLink>
        {LIFECYCLE_STATES.filter((state) => state !== "active").map((state) => (
          <TabLink key={state} href={href(state)} active={lifecycle === state} count={all.filter((row) => row.application.lifecycle === state).length}>
            <Status state={state} size="sm" />
          </TabLink>
        ))}
      </Tabs>
      <Panel flush>
        {rows.length > 0 ? (
          <Table
            label="Web Applications"
            head={
              <>
                <Th>Name</Th>
                <Th>Launch target</Th>
                <Th>Lifecycle</Th>
                <Th align="numeric">Served in</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {rows.map(({ application, launch, portals, draft }) => {
              const name = applicationName(application);
              return (
                <tr key={application.publicId}>
                  <Td label="Name">
                    <Primary>
                      <Link href={applicationHref(application.publicId)}>{name}</Link>
                    </Primary>
                    <Secondary>{[application.ownerTeam ? `Owned by ${application.ownerTeam}` : "No owning team yet", application.sealId && `SEAL ID ${application.sealId}`, draft && "Draft open"].filter(Boolean).join(" · ")}</Secondary>
                  </Td>
                  <Td label="Launch target">
                    {launch ? (
                      <>
                        {launch.kind === "mfe" ? "Registered MFE" : "External endpoint"}
                        <Secondary>{`${RENDERING_MODE_LABELS[launch.mode as keyof typeof RENDERING_MODE_LABELS]} · revision ${launch.number}`}</Secondary>
                      </>
                    ) : (
                      <Secondary>Not submitted yet</Secondary>
                    )}
                  </Td>
                  <Td label="Lifecycle">
                    <Status state={application.lifecycle} />
                  </Td>
                  <Td label="Served in" align="numeric">
                    {countLabel(portals, "Portal")}
                  </Td>
                  <Td align="actions">
                    <RowActions>
                      <Menu label={`Actions for ${name}`}>
                        <MenuItem href={applicationHref(application.publicId)} icon="eye">
                          Open
                        </MenuItem>
                        {draft && (
                          <MenuItem href={applicationStepHref(application.publicId, "identity")} icon="edit">
                            Edit Draft
                          </MenuItem>
                        )}
                      </Menu>
                    </RowActions>
                  </Td>
                </tr>
              );
            })}
          </Table>
        ) : search ? (
          <EmptyState title="No matching Web Applications" icon="search">{`No Web Application name, team, or SEAL ID contains “${search}”.`}</EmptyState>
        ) : placement ? (
          <EmptyState title={placement === "placed" ? "No placed Web Applications" : "No unplaced Web Applications"}>{placement === "placed" ? "A Web Application is placed once a Portal approves one of its placements." : "Every Web Application listed here is placed in a Portal."}</EmptyState>
        ) : lifecycle ? (
          <EmptyState title={`No ${lifecycle} Web Applications`}>A Web Application becomes Ready when its launch target is confirmed and at least one Portal approves a placement.</EmptyState>
        ) : (
          <EmptyState title="No Web Applications yet" icon="layers" action={create}>
            Onboard a route-level experience: how it launches, the MFEs it composes, and the Portals it asks to be placed in.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
