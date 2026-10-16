import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NewPortalLink } from "@/components/onboarding/create-portal";
import { EmptyState } from "@/components/ui/empty-state";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tabs, TabLink } from "@/components/ui/tabs";
import { getDb } from "@/lib/db/client";
import { NAVIGATION_TABS, type NavigationTab, portalCatalog } from "@/lib/onboarding/catalog";
import { PORTAL_LIFECYCLE_LABELS, PORTAL_PLATFORM_LABELS } from "@/lib/onboarding/vocabulary";
import { navigationListHref } from "@/lib/web/list-filters";
import { rememberedPortal } from "@/lib/web/portal-cookie";
import { navigationHref } from "./paths";

export const metadata: Metadata = { title: "Navigation" };

const TAB_LABELS: Record<NavigationTab, string> = { all: "All", prototype: "Prototype", production: "Production" };

/**
 * Navigation (navigation spec, "Navigation opens the current Portal"): the
 * current Portal's Navigation page, or, with All Portals current or
 * `portal=all` in the address, every onboarded Portal with its platform,
 * lifecycle, and counts, under lifecycle tabs kept in the address.
 */
export default async function NavigationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const db = getDb();
  if (param(params, "portal") !== "all") {
    const current = await rememberedPortal(db);
    if (current) redirect(navigationHref(current.publicId));
  }
  const requested = param(params, "tab");
  const tab = NAVIGATION_TABS.find((candidate) => candidate === requested) ?? "all";
  const { rows, counts } = portalCatalog(db, tab);

  return (
    <Page>
      <PageHeader title="Navigation" description="Each Portal's menu, default route, and lifecycle. Choose a Portal to arrange its menu." primaryAction={<NewPortalLink>Create Portal</NewPortalLink>} />
      <Tabs label="Portals by lifecycle">
        {NAVIGATION_TABS.map((candidate) => (
          <TabLink key={candidate} href={navigationListHref({ tab: candidate })} active={candidate === tab} count={counts[candidate]}>
            {TAB_LABELS[candidate]}
          </TabLink>
        ))}
      </Tabs>
      <Panel flush>
        {rows.length > 0 ? (
          <Table
            label="Portals"
            head={
              <>
                <Th>Portal</Th>
                <Th>Platform</Th>
                <Th>Lifecycle</Th>
                <Th align="numeric">Menu items</Th>
                <Th align="numeric">Applications</Th>
              </>
            }
          >
            {rows.map(({ portal, menuItems, applications }) => (
              <tr key={portal.publicId}>
                <Td label="Portal">
                  <Primary>
                    <Link href={navigationHref(portal.publicId)}>{portal.label}</Link>
                  </Primary>
                  {portal.slug && <Secondary>{portal.slug}</Secondary>}
                </Td>
                <Td label="Platform">{portal.platform ? PORTAL_PLATFORM_LABELS[portal.platform] : <Secondary>None</Secondary>}</Td>
                <Td label="Lifecycle">
                  <Status state={portal.lifecycle} label={PORTAL_LIFECYCLE_LABELS[portal.lifecycle]} size="sm" />
                </Td>
                <Td label="Menu items" align="numeric">
                  {menuItems}
                </Td>
                <Td label="Applications" align="numeric">
                  {applications}
                </Td>
              </tr>
            ))}
          </Table>
        ) : counts.all === 0 ? (
          <EmptyState title="No Portals yet" icon="network" action={<NewPortalLink>Create Portal</NewPortalLink>}>
            A Portal is configuration its team owns: its menu, its default route, and whether it&apos;s a Prototype or in Production.
          </EmptyState>
        ) : (
          <EmptyState title={`No ${TAB_LABELS[tab]} Portals`}>{tab === "production" ? "Promote a Portal from its Navigation page once it has a default route." : "Every Portal is in Production."}</EmptyState>
        )}
      </Panel>
    </Page>
  );
}
