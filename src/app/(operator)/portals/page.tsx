import type { Metadata } from "next";
import Form from "next/form";
import { NewPortalLink } from "@/components/onboarding/create-portal";
import { PortalCard } from "@/components/onboarding/portal-card";
import { ButtonLink } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { SearchField } from "@/components/ui/search-field";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { getDb } from "@/lib/db/client";
import { PORTAL_TABS, type PortalTab, portalCatalog } from "@/lib/onboarding/catalog";
import { portalsHref } from "@/lib/web/list-filters";
import styles from "../applications/list.module.css";
import { openPortalAction } from "./actions";

export const metadata: Metadata = { title: "Portals" };

const TAB_LABELS: Record<PortalTab, string> = { all: "All", prototype: "Prototype", production: "Production" };

/**
 * The Portals page (runtime-configuration spec): every onboarded Portal as a
 * card, searched and filtered by lifecycle in the address, with Create
 * Portal. Choosing a card makes that Portal current and opens its Experience
 * Editor. It isn't scoped by the switcher.
 */
export default async function PortalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const db = getDb();
  const requested = param(params, "tab");
  const tab = PORTAL_TABS.find((candidate) => candidate === requested) ?? "all";
  const search = (param(params, "q") ?? "").slice(0, 200);
  const { rows, counts } = portalCatalog(db, tab, search);
  const anyPortal = search ? portalCatalog(db).counts.all > 0 : counts.all > 0;

  return (
    <Page>
      <PageHeader title="Portals" description="Every Portal its team configures. Choose one to open its Experience Editor." primaryAction={<NewPortalLink>Create Portal</NewPortalLink>} />
      {anyPortal && (
        <>
          <div className={styles.toolbar}>
            <Form key={search} action="/portals" scroll={false} className={styles.search} role="search" aria-label="Search Portals">
              {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
              <SearchField id="portal-search" name="q" label="Search Portals" hideLabel placeholder="Search Portals…" defaultValue={search} clearHref={portalsHref({ tab })} shortcut="/" />
            </Form>
          </div>
          <Tabs label="Portals by lifecycle">
            {PORTAL_TABS.map((candidate) => (
              <TabLink key={candidate} href={portalsHref({ tab: candidate, q: search })} active={candidate === tab} count={counts[candidate]}>
                {TAB_LABELS[candidate]}
              </TabLink>
            ))}
          </Tabs>
        </>
      )}
      {rows.length > 0 ? (
        <CardGrid label="Portals">
          {rows.map((row) => (
            <li key={row.portal.publicId}>
              <PortalCard row={row} action={openPortalAction} />
            </li>
          ))}
        </CardGrid>
      ) : (
        <Panel flush>
          {!anyPortal ? (
            <EmptyState title="No Portals yet" icon="network" action={<NewPortalLink>Create Portal</NewPortalLink>}>
              A Portal is configuration its team owns: its experience, its menu, and whether it&apos;s a Prototype or in Production.
            </EmptyState>
          ) : search ? (
            <EmptyState
              title="No Portals match"
              icon="search"
              action={
                <ButtonLink href={portalsHref({ tab })} variant="secondary">
                  Clear search
                </ButtonLink>
              }
            >
              {`No Portal matches “${search}”${tab === "all" ? "" : ` on the ${TAB_LABELS[tab]} tab`}.`}
            </EmptyState>
          ) : (
            <EmptyState title={`No ${TAB_LABELS[tab]} Portals`}>{tab === "production" ? "Promote a Portal from its Portal page once it has a default route." : "Every Portal is in Production."}</EmptyState>
          )}
        </Panel>
      )}
    </Page>
  );
}
