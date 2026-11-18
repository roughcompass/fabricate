import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { navFlags } from "@/components/shell/nav-flags";
import { HOME, homeLink, visibleGroups } from "@/components/shell/navigation";
import { ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { BarChart, type BarSeries } from "@/components/ui/bar-chart";
import { ATTENTION_PAGE_SIZE, type AttentionItem, attentionItems } from "@/lib/home/attention";
import { type ActivityKind, WEEK_MS, assessmentTrend, figureChanges, figuresAt, recentActivity } from "@/lib/home/dashboard";
import { type FleetSummary, claimedShare, fleetSummary } from "@/lib/home/summary";
import { assessmentsHref, repositoriesHref } from "@/lib/web/list-filters";
import styles from "./home.module.css";

// The root layout's title template applies only to child segments, and this page shares the root segment.
export const metadata: Metadata = { title: { absolute: "Home · DE FabLab" } };

const DE_CONSOLE = "/repositories/de-console";

/** The time this request renders, which each figure's change over the week is measured from. */
function requestTime(): number {
  return Date.now();
}

/**
 * Home (home spec), laid out as a dashboard: the fleet's figures, each
 * opening a list filtered to exactly what it counts, with its change over the
 * last seven days; the Assessment trend beside the recent activity; the
 * problems that need someone; and quick actions. Every visitor sees the same
 * page. Where Assessments aren't available, the root address
 * opens wherever links to Home lead instead.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const config = getConfig();
  const home = homeLink(visibleGroups(navFlags(config)));
  if (home.href !== HOME.href) redirect(home.href);

  const query = await searchParams;
  const db = getDb();
  const summary = fleetSummary(db);
  const items = attentionItems(db, config);
  const pages = Math.max(1, Math.ceil(items.length / ATTENTION_PAGE_SIZE));
  const requested = Number.parseInt(param(query, "page") ?? "1", 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  const shown = items.slice((page - 1) * ATTENTION_PAGE_SIZE, page * ATTENTION_PAGE_SIZE);

  const then = figuresAt(db, new Date(requestTime() - WEEK_MS));
  const changes = figureChanges(summary, then, claimedShare);
  const trend = assessmentTrend(db);
  const activity = recentActivity(db);

  return (
    <Page>
      <PageHeader title="Home" description="Where the fleet's Repositories and Assessments stand, what changed, and what needs someone's attention." />

      <div className={styles.row} data-columns="2">
        <Panel title="Repositories" description="Enabled Repositories, and whether each has a SEAL application.">
          {summary.repositories.empty ? (
            <EmptyState
              title="No Repositories yet"
              icon="git"
              action={
                <>
                  <ButtonLink href="/repositories/bulk" variant="secondary" icon="layers">
                    Add Repositories
                  </ButtonLink>
                  <ButtonLink href="/repositories/new" variant="secondary" icon="plus">
                    New Repository
                  </ButtonLink>
                </>
              }
            >
              Register Git repositories to claim and assess them.
            </EmptyState>
          ) : (
            <Figures label="Repositories" figures={repositoryStats(summary.repositories, changes)} />
          )}
        </Panel>

        <Panel title="Assessments" description="By the conclusion of each Assessment's latest completed Evaluation.">
          {summary.assessments.empty ? (
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
          ) : (
            <Figures label="Assessments" figures={assessmentStats(summary.assessments, changes)} />
          )}
        </Panel>
      </div>

      <div className={styles.row} data-columns="2">
        <Panel title="Assessment trend" description="Evaluations completed each week, by conclusion, over the last eight weeks.">
          <BarChart
            id="assessment-trend"
            label="Evaluations completed each week, by conclusion"
            groupLabel="Week of"
            series={TREND_SERIES}
            groups={trend.map((week) => ({ label: weekLabel(week.start), values: week.counts }))}
            empty="No Evaluation completed in the last eight weeks."
          />
        </Panel>

        <Panel title="Recent activity" description="The latest finished Runs." flush={activity.length > 0}>
          {activity.length > 0 ? (
            <ol className={styles.activity} aria-label="Recent activity">
              {activity.map((item) => (
                <li key={`${item.kind}-${item.record.href}-${item.at.getTime()}`} data-activity={item.kind}>
                  <span className={styles.activityWhat}>
                    {ACTIVITY_LABELS[item.kind]} <Link href={item.record.href}>{item.record.name}</Link>
                  </span>
                  <span className={styles.muted}>
                    <RelativeTime value={item.at} />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="Nothing has happened yet">Finished Runs appear here.</EmptyState>
          )}
        </Panel>
      </div>

      <div id="needs-attention" className={styles.attention}>
        <Panel title="Needs attention" description={items.length > 0 ? countLabel(items.length, "problem") : undefined} flush>
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
      </div>

      <Panel title="Quick actions">
        <div className={styles.actions} role="group" aria-label="Quick actions">
          <ButtonLink href="/assessments/new" variant="secondary" icon="checklist">
            New Assessment
          </ButtonLink>
          <ButtonLink href="/repositories/bulk" variant="secondary" icon="layers">
            Add Repositories
          </ButtonLink>
        </div>
      </Panel>
    </Page>
  );
}

const TREND_SERIES: BarSeries[] = [
  { id: "gaps", label: "Gaps found", tone: "error", pattern: "stripes" },
  { id: "undetermined", label: "Undetermined", tone: "warning", pattern: "dots" },
  { id: "conforms", label: "Conforms", tone: "success", pattern: "solid" },
  { id: "not_applicable", label: "Not applicable", tone: "neutral", pattern: "lines" },
];

const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  run_completed: "Run finished:",
  run_failed: "Run failed:",
};

/** A week's first day, as the chart labels it: "Oct 12". */
const weekLabel = (start: Date) => start.toLocaleDateString("en-US", { month: "short", day: "numeric" });

interface Figure {
  label: string;
  value: string;
  /** Its change over the last seven days, in words. */
  change: string;
  /** A short line under the value, such as a share. */
  hint?: string;
  href: string;
}

/** A group's figures, two per row, each linking to the list it counts, with its share and its change this week. */
function Figures({ label, figures }: { label: string; figures: readonly Figure[] }) {
  return (
    <dl className={styles.figures} aria-label={label}>
      {figures.map((entry) => (
        <div key={entry.label} className={styles.figure} data-figure={entry.label}>
          <dt className={styles.figureLabel}>{entry.label}</dt>
          <dd className={styles.figureValue}>
            <Link href={entry.href}>{entry.value}</Link>
          </dd>
          {entry.hint && <dd className={styles.muted}>{entry.hint}</dd>}
          <dd className={styles.change} data-change={entry.change.startsWith("+") ? "up" : entry.change.startsWith("−") ? "down" : "none"}>
            {entry.change}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const figure = (value: number) => value.toLocaleString("en-US");

function repositoryStats(repositories: FleetSummary["repositories"], changes: Record<string, string>): Figure[] {
  const share = claimedShare(repositories);
  return [
    { label: "Enabled", value: figure(repositories.enabled), change: changes.enabled!, href: repositoriesHref({ status: "enabled" }) },
    { label: "Claimed", value: figure(repositories.claimed), hint: share === null ? undefined : `${share}% of enabled`, change: changes.claimed!, href: repositoriesHref({ status: "enabled", ownership: "claimed" }) },
    { label: "Unclaimed", value: figure(repositories.unclaimed), change: changes.unclaimed!, href: repositoriesHref({ status: "enabled", ownership: "unclaimed" }) },
  ];
}

function assessmentStats(assessments: FleetSummary["assessments"], changes: Record<string, string>): Figure[] {
  const { byConclusion } = assessments;
  return [
    { label: "Assessments", value: figure(assessments.total), change: changes.assessments!, href: assessmentsHref() },
    { label: "Gaps found", value: figure(byConclusion.gaps), change: changes.gaps!, href: assessmentsHref({ conclusion: "gaps" }) },
    { label: "Undetermined", value: figure(byConclusion.undetermined), change: changes.undetermined!, href: assessmentsHref({ conclusion: "undetermined" }) },
    { label: "Conforms", value: figure(byConclusion.conforms), change: changes.conforms!, href: assessmentsHref({ conclusion: "conforms" }) },
    ...(byConclusion.not_applicable > 0 ? [{ label: "Not applicable", value: figure(byConclusion.not_applicable), change: changes.not_applicable!, href: assessmentsHref({ conclusion: "not_applicable" }) }] : []),
    { label: "Not evaluated", value: figure(byConclusion.none), change: changes.none!, href: assessmentsHref({ conclusion: "none" }) },
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
