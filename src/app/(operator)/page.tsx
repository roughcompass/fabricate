import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { navFlags } from "@/components/shell/nav-flags";
import { HOME, homeLink, visibleSections } from "@/components/shell/navigation";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { type StatItem, StatGroup } from "@/components/ui/stat-group";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { ATTENTION_PAGE_SIZE, type AttentionItem, attentionItems } from "@/lib/home/attention";
import { type FleetSummary, claimedShare, fleetSummary } from "@/lib/home/summary";
import { applicationsHref, assessmentsHref, navigationListHref, repositoriesHref } from "@/lib/web/list-filters";

// The root layout's title template applies only to child segments, and this page shares the root segment.
export const metadata: Metadata = { title: { absolute: "Home · DE FabLab" } };

const DE_CONSOLE = "/repositories/de-console";

/**
 * Home (home spec): the fleet's figures, each opening a list filtered to
 * exactly what it counts, then the problems that need someone. Every visitor
 * sees the same page. Where Assessments aren't available, the root address
 * opens wherever links to Home lead instead.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const config = getConfig();
  const home = homeLink(visibleSections(navFlags(config)));
  if (home.href !== HOME.href) redirect(home.href);

  const query = await searchParams;
  const db = getDb();
  const summary = fleetSummary(db);
  const items = attentionItems(db, config);
  const pages = Math.max(1, Math.ceil(items.length / ATTENTION_PAGE_SIZE));
  const requested = Number.parseInt(param(query, "page") ?? "1", 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  const shown = items.slice((page - 1) * ATTENTION_PAGE_SIZE, page * ATTENTION_PAGE_SIZE);

  return (
    <Page>
      <PageHeader title="Home" description="How much of the fleet is claimed, where its Assessments stand, and what needs someone's attention." />

      <Section title="Repositories" description="Enabled Repositories, and whether each has a SEAL application.">
        {summary.repositories.empty ? (
          <Panel flush>
            <EmptyState
              title="No Repositories yet"
              icon="git"
              action={
                <>
                  <ButtonLink href="/repositories/import" variant="secondary" icon="folder">
                    Import Repositories
                  </ButtonLink>
                  <ButtonLink href="/repositories/new" variant="secondary" icon="plus">
                    New Repository
                  </ButtonLink>
                </>
              }
            >
              Register Git repositories to claim and assess them.
            </EmptyState>
          </Panel>
        ) : (
          <StatGroup label="Repositories" stats={repositoryStats(summary.repositories)} />
        )}
      </Section>

      <Section title="Assessments" description="By the conclusion of each Assessment's latest completed Evaluation.">
        {summary.assessments.empty ? (
          <Panel flush>
            <EmptyState
              title="No Assessments yet"
              icon="checklist"
              action={
                <ButtonLink href="/assessments/new" variant="secondary" icon="plus">
                  New Assessment
                </ButtonLink>
              }
            >
              An Assessment scopes Repositories for Runs and evaluates them against Standard Releases.
            </EmptyState>
          </Panel>
        ) : (
          <StatGroup label="Assessments" stats={assessmentStats(summary.assessments)} />
        )}
      </Section>

      <Section title="Applications" description="Registered Applications, those DE Web couldn't determine a rendering for, and Portals in Production.">
        {summary.applications.empty ? (
          <Panel flush>
            <EmptyState
              title="No Applications yet"
              icon="network"
              action={
                <>
                  <ButtonLink href="/navigation/new" variant="secondary" icon="plus">
                    Create Portal
                  </ButtonLink>
                  <ButtonLink href="/applications/new" variant="secondary" icon="plus">
                    Add application
                  </ButtonLink>
                </>
              }
            >
              Create a Portal, then add the Applications its menu points at.
            </EmptyState>
          </Panel>
        ) : (
          <StatGroup
            label="Applications"
            stats={[
              { label: "Applications", value: figure(summary.applications.applications), href: applicationsHref({ portal: "all" }) },
              { label: "Undetermined rendering", value: figure(summary.applications.undetermined), href: applicationsHref({ portal: "all", rendering: "undetermined" }) },
              { label: "Production Portals", value: figure(summary.applications.productionPortals), href: navigationListHref({ tab: "production" }) },
            ]}
          />
        )}
      </Section>

      <Section id="needs-attention" title="Needs attention" description={items.length > 0 ? countLabel(items.length, "problem") : undefined}>
        <Panel flush>
          {shown.length > 0 ? (
            <Table
              label="Needs attention"
              head={
                <>
                  <Th>Problem</Th>
                  <Th>Record</Th>
                  <Th>Since</Th>
                </>
              }
            >
              {shown.map((item) => (
                <AttentionRow key={`${item.kind}-${"run" in item ? item.run.publicId : "evaluation" in item ? item.evaluation.publicId : item.kind}`} item={item} refreshMinutes={config.deConsole.refreshMinutes} />
              ))}
            </Table>
          ) : (
            <EmptyState title="Nothing needs attention">{"Home checks each Assessment's latest Run and Evaluation, and the DE Console import."}</EmptyState>
          )}
        </Panel>
        <Pagination label="Needs attention pages" page={page} pages={pages} href={(number) => (number === 1 ? "/#needs-attention" : `/?page=${number}#needs-attention`)} />
      </Section>
    </Page>
  );
}

const figure = (value: number) => value.toLocaleString("en-US");

function repositoryStats(repositories: FleetSummary["repositories"]): StatItem[] {
  const share = claimedShare(repositories);
  return [
    { label: "Enabled", value: figure(repositories.enabled), href: repositoriesHref({ status: "enabled" }) },
    { label: "Claimed", value: figure(repositories.claimed), hint: share === null ? undefined : `${share}% of enabled`, href: repositoriesHref({ status: "enabled", ownership: "claimed" }) },
    { label: "Unclaimed", value: figure(repositories.unclaimed), href: repositoriesHref({ status: "enabled", ownership: "unclaimed" }) },
  ];
}

function assessmentStats(assessments: FleetSummary["assessments"]): StatItem[] {
  const { byConclusion } = assessments;
  return [
    { label: "Assessments", value: figure(assessments.total), href: assessmentsHref() },
    { label: "Gaps found", value: figure(byConclusion.gaps), href: assessmentsHref({ conclusion: "gaps" }) },
    { label: "Undetermined", value: figure(byConclusion.undetermined), href: assessmentsHref({ conclusion: "undetermined" }) },
    { label: "Conforms", value: figure(byConclusion.conforms), href: assessmentsHref({ conclusion: "conforms" }) },
    ...(byConclusion.not_applicable > 0 ? [{ label: "Not applicable", value: figure(byConclusion.not_applicable), href: assessmentsHref({ conclusion: "not_applicable" }) }] : []),
    { label: "Not evaluated", value: figure(byConclusion.none), href: assessmentsHref({ conclusion: "none" }) },
  ];
}

/** One problem: what it is, linked to the page that shows it; the record it concerns; and when it began. */
function AttentionRow({ item, refreshMinutes }: { item: AttentionItem; refreshMinutes: number }) {
  const { title, href, detail, record } = describe(item, refreshMinutes);
  return (
    <tr>
      <Td label="Problem">
        <Primary>
          <Link href={href}>{title}</Link>
        </Primary>
        {detail && <Secondary>{detail}</Secondary>}
      </Td>
      <Td label="Record">{record}</Td>
      <Td label="Since">
        <RelativeTime value={item.since} />
      </Td>
    </tr>
  );
}

function describe(item: AttentionItem, refreshMinutes: number): { title: string; href: string; detail?: React.ReactNode; record: string } {
  switch (item.kind) {
    case "run_failed":
      return { title: `Run #${item.run.number} failed`, href: `/runs/${item.run.publicId}`, record: item.assessment.name };
    case "run_with_issues":
      return { title: `Run #${item.run.number} couldn't assess ${countLabel(item.unassessed, "Repository", "Repositories")}`, href: `/runs/${item.run.publicId}`, record: item.assessment.name };
    case "evaluation_failed":
      return { title: `Evaluation #${item.evaluation.number} failed`, href: `/evaluations/${item.evaluation.publicId}`, record: item.assessment.name };
    case "de_console_failed":
      return {
        title: "The DE Console couldn't be read",
        href: DE_CONSOLE,
        record: "DE Console import",
        detail: item.lastSuccess ? (
          <>
            Its values are from <RelativeTime value={item.lastSuccess} />.
          </>
        ) : (
          "Nothing has been read from it yet."
        ),
      };
    case "de_console_stale":
      return {
        title: "DE Console values are out of date",
        href: DE_CONSOLE,
        record: "DE Console import",
        detail: (
          <>
            Last read <RelativeTime value={item.since} />, with reads scheduled every {countLabel(refreshMinutes, "minute")}.
          </>
        ),
      };
    case "de_console_conflicts":
      return { title: `${countLabel(item.count, "DE Console entry", "DE Console entries")} ${item.count === 1 ? "is" : "are"} in conflict`, href: `${DE_CONSOLE}#conflicts`, record: "DE Console import" };
  }
}
