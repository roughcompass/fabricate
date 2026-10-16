import type { Metadata } from "next";
import Link from "next/link";
import { Attributed } from "@/components/onboarding/attribution";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/form";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { SearchField } from "@/components/ui/search-field";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import type { PlacementState } from "@/lib/db/schema";
import { portalCatalog } from "@/lib/onboarding/catalog";
import { REVIEW_STATES, reviewQueue } from "@/lib/onboarding/reviews";
import { rememberedPortal } from "@/lib/web/portal-cookie";
import { reviewHref } from "./load";

export const metadata: Metadata = { title: "Reviews" };

const STATE_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", retired: "Retired" } as const;

/** Placement reviews, one row per placement for its latest request, filtered by state, Portal, and search, all in the URL. */
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const db = getDb();
  const state = REVIEW_STATES.find((candidate) => candidate === param(query, "state")) ?? null;
  const portals = portalCatalog(db).map((row) => row.portal);
  const addressed = portals.find((candidate) => candidate.publicId === param(query, "portal"))?.publicId ?? null;
  // A Portal the address names wins, so a link opens the reviews it names; otherwise the sidebar's current Portal scopes the list (portal-switcher spec).
  const current = addressed ? null : await rememberedPortal(db);
  const portal = addressed ?? current?.publicId ?? null;
  const search = (param(query, "q") ?? "").trim().slice(0, 200);
  const scoped = reviewQueue(db, { portal, search });
  const rows = state ? scoped.filter((row) => row.state === state) : scoped;
  const href = (next: { state?: PlacementState | null; portal?: string | null; q?: string }) => {
    const values = { state, portal: addressed, q: search, ...next };
    const params = new URLSearchParams({ ...(values.state && { state: values.state }), ...(values.portal && { portal: values.portal }), ...(values.q && { q: values.q }) });
    return `/onboarding/reviews${params.size ? `?${params}` : ""}`;
  };

  return (
    <Page>
      <PageHeader
        title="Reviews"
        description={
          current
            ? `Scoped to ${current.label}: each placement an Application asks of it, reviewed on its own. Decisions are recorded here, unverified, and change nothing in Studio or CDaaS. Choose All Portals in the sidebar to see every Portal's reviews.`
            : "Each placement an Application asks of a Portal, reviewed by that Portal on its own. Decisions are recorded here, unverified, and change nothing in Studio or CDaaS."
        }
      />
      <Tabs
        label="Filter reviews by state"
        aside={
          <FilterBar key={`${addressed}-${search}`} action="/onboarding/reviews" label="Filter reviews" filtered={Boolean(addressed || search)} clearHref={href({ portal: null, q: "" })} keep={state ? { state } : {}}>
            {!current && <Select id="review-portal" name="portal" label="Portal" hideLabel size="sm" defaultValue={addressed ?? ""} options={[{ value: "", label: "All Portals" }, ...portals.map((item) => ({ value: item.publicId, label: item.label }))]} />}
            <SearchField id="review-search" name="q" label="Search reviews" hideLabel size="sm" placeholder="Search by Application, Portal, route, or submitter" defaultValue={search} clearHref={href({ q: "" })} />
          </FilterBar>
        }
      >
        <TabLink href={href({ state: null })} active={state === null} count={scoped.length}>
          All
        </TabLink>
        {REVIEW_STATES.map((candidate) => (
          <TabLink key={candidate} href={href({ state: candidate })} active={state === candidate} count={scoped.filter((row) => row.state === candidate).length}>
            <Status state={candidate} label={STATE_LABELS[candidate]} size="sm" />
          </TabLink>
        ))}
      </Tabs>
      <Panel flush>
        {rows.length > 0 ? (
          <Table
            label="Placement reviews"
            head={
              <>
                <Th>Placement</Th>
                <Th>Revision</Th>
                <Th>Submitted by</Th>
                <Th>State</Th>
                <Th>Since</Th>
              </>
            }
          >
            {rows.map((row) => (
              <tr key={row.placement}>
                <Td label="Placement">
                  <Primary>
                    <Link href={reviewHref(row.placement)}>{`${row.application.name} · ${row.portal.name}`}</Link>
                  </Primary>
                  <Secondary>
                    <Tag label="route">{row.route}</Tag>
                  </Secondary>
                </Td>
                <Td label="Revision">
                  <Link href={`/onboarding/applications/${row.application.publicId}/revisions/${row.revision}`}>{`Revision ${row.revision}`}</Link>
                  {row.application.sealId && <Secondary>{`SEAL ID ${row.application.sealId}`}</Secondary>}
                </Td>
                <Td label="Submitted by">{row.submittedBy ? <Attributed name={row.submittedBy} attribution="unverified" /> : "—"}</Td>
                <Td label="State">
                  <Status state={row.state} label={STATE_LABELS[row.state]} />
                  {row.state !== "approved" && row.effective === "approved" && <Secondary>An earlier approval is still served</Secondary>}
                </Td>
                <Td label="Since">
                  <RelativeTime value={row.since} />
                </Td>
              </tr>
            ))}
          </Table>
        ) : search || addressed || state ? (
          <EmptyState title="No matching reviews" icon="search">
            No placement review matches these filters.
          </EmptyState>
        ) : current ? (
          <EmptyState title={`No placements to review in ${current.label}`} icon="inbox">{`Each placement a Web Application requests in ${current.label} appears here for its team to review.`}</EmptyState>
        ) : (
          <EmptyState title="No placements to review yet" icon="inbox">
            Each placement a Web Application requests appears here for its Portal to review.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
