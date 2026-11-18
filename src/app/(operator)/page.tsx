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
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { profilingActivity } from "@/lib/profiling/versions";
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
 * Home (home spec), read in the order a person acts: the actions that start
 * work, in the header; what needs someone, first; then where the fleet
 * stands, as four cards that each open the list they count, with the share
 * they cover and their change over the last seven days; then the Assessment
 * trend beside the latest finished Runs. Every visitor sees the same page.
 * Where Assessments aren't available, the root address opens wherever links
 * to Home lead instead.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const config = getConfig();
  const home = homeLink(visibleGroups(navFlags(config)));
  if (home.href !== HOME.href) redirect(home.href);

  const query = await searchParams;
  const db = getDb();
  const summary = fleetSummary(db);
  const profiling = profilingActivity(db);
  const items = attentionItems(db, config);
  const pages = Math.max(1, Math.ceil(items.length / ATTENTION_PAGE_SIZE));
  const requested = Number.parseInt(param(query, "page") ?? "1", 10);
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pages) : 1;
  const shown = items.slice((page - 1) * ATTENTION_PAGE_SIZE, page * ATTENTION_PAGE_SIZE);

  const then = figuresAt(db, new Date(requestTime() - WEEK_MS));
  const changes = figureChanges(summary, then, claimedShare);
  const trend = assessmentTrend(db);
  const activity = recentActivity(db).slice(0, ACTIVITY_SHOWN);

  return (
    <Page>
      <PageHeader
        title="Home"
        description="What needs attention, where the fleet's Repositories and Assessments stand, and what changed this week."
        primaryAction={
          <ButtonLink href="/assessments/new" variant="primary" icon="plus">
            New Assessment
          </ButtonLink>
        }
        secondaryActions={[{ href: "/repositories/bulk", label: "Add Repositories", icon: "layers" }]}
      />

      <div id="needs-attention" className={styles.attention}>
        <Panel title="Needs attention" description={items.length > 0 ? countLabel(items.length, "problem") : undefined} flush={shown.length > 0}>
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
            // Nothing to do takes one line, so it never pushes the figures down.
            <div className={styles.clear}>
              <Status state="clear" label="Nothing needs attention" />
              <span className={styles.muted}>{"Home checks each Assessment's latest Run and Evaluation, and the DE Console import."}</span>
            </div>
          )}
        </Panel>
        <Pagination label="Needs attention pages" page={page} pages={pages} href={(number) => (number === 1 ? "/#needs-attention" : `/?page=${number}#needs-attention`)} />
      </div>

      <div className={styles.overview}>
        <section className={styles.group} data-group="repositories" aria-label="Repositories">
          {summary.repositories.empty ? (
            <Panel title="Repositories" description="Every Repository, profiled in the background, and whether each has a SEAL application.">
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
                Register Git repositories to profile, claim, and assess them.
              </EmptyState>
            </Panel>
          ) : (
            <dl className={styles.cards} aria-label="Repositories">
              <RepositoryCards repositories={summary.repositories} profiling={profiling.profiling + profiling.queued} changes={changes} />
            </dl>
          )}
        </section>

        <section className={styles.group} data-group="assessments" aria-label="Assessments">
          {summary.assessments.empty ? (
            <Panel title="Assessments" description="By the conclusion of each Assessment's latest completed Evaluation.">
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
            <dl className={`${styles.cards} ${styles.single}`} aria-label="Assessments">
              <AssessmentCard assessments={summary.assessments} changes={changes} />
            </dl>
          )}
        </section>
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
                    <Status state={item.kind === "run_failed" ? "failed" : "complete"} size="sm" label="" />
                    <span className="visually-hidden">{ACTIVITY_LABELS[item.kind]} </span>
                    <Link href={item.record.href}>{item.record.name}</Link>
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
    </Page>
  );
}

/** How many finished Runs Recent activity lists, so it stands about as tall as the trend beside it. */
const ACTIVITY_SHOWN = 6;

const TREND_SERIES: BarSeries[] = [
  { id: "gaps", label: "Gaps found", tone: "error", pattern: "stripes" },
  { id: "undetermined", label: "Undetermined", tone: "warning", pattern: "dots" },
  { id: "conforms", label: "Conforms", tone: "success", pattern: "solid" },
  { id: "not_applicable", label: "Not applicable", tone: "neutral", pattern: "lines" },
];

// Read before each activity's name by assistive technology; the status dot shows it.
const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  run_completed: "Run finished:",
  run_failed: "Run failed:",
};

/** A week's first day, as the chart labels it: "Oct 12". */
const weekLabel = (start: Date) => start.toLocaleDateString("en-US", { month: "short", day: "numeric" });

const figure = (value: number) => value.toLocaleString("en-US");
const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/** A week's change, set apart by direction so it reads at a glance, and stated in words so it never relies on color. */
function Change({ change }: { change: string }) {
  return (
    <dd className={styles.change} data-change={change.startsWith("+") ? "up" : change.startsWith("−") ? "down" : "none"}>
      {change}
    </dd>
  );
}

/** A share as a bar, with its percentage in words for assistive technology. */
function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <dd className={styles.meter} role="img" aria-label={`${label}: ${percent(value, max)}%`}>
      <span className={styles.meterFill} style={{ inlineSize: `${percent(value, max)}%` }} />
    </dd>
  );
}

/**
 * The Repositories cards: how many there are, how many are profiled and
 * claimed, each with its share of all as a bar. Each count opens the list it
 * counts; Unclaimed is the link under Claimed.
 */
function RepositoryCards({ repositories, profiling, changes }: { repositories: FleetSummary["repositories"]; profiling: number; changes: Record<string, string> }) {
  const { total, claimed, unclaimed, profiled } = repositories;
  return (
    <>
      <div className={styles.card} data-figure="Repositories">
        <dt className={styles.cardLabel}>Repositories</dt>
        <dd className={styles.cardValue}>
          <Link href={repositoriesHref()}>{figure(total)}</Link>
        </dd>
        <dd className={styles.muted}>In the catalog</dd>
        <Change change={changes.repositories!} />
      </div>
      <div className={styles.card} data-figure="Profiled">
        <dt className={styles.cardLabel}>Profiled</dt>
        {/* A count, not a link: the Repositories list can't be filtered to the profiled ones. */}
        <dd className={styles.cardValue}>
          {figure(profiled)}
          <span className={styles.cardOf}>{`of ${figure(total)}`}</span>
        </dd>
        <Meter value={profiled} max={total} label="Profiled" />
        <dd className={styles.muted}>{profiling > 0 ? `${figure(profiling)} profiling or queued now` : profiled === total ? "Every Repository has a profile" : "Each is profiled in the background"}</dd>
      </div>
      <div className={styles.card} data-figure="Claimed">
        <dt className={styles.cardLabel}>Claimed</dt>
        <dd className={styles.cardValue}>
          <Link href={repositoriesHref({ ownership: "claimed" })}>{figure(claimed)}</Link>
          <span className={styles.cardOf}>{`of ${figure(total)} · ${percent(claimed, total)}% of all`}</span>
        </dd>
        <Meter value={claimed} max={total} label="Claimed" />
        <dd className={styles.muted} data-figure="Unclaimed">
          <Link href={repositoriesHref({ ownership: "unclaimed" })}>{`${figure(unclaimed)} unclaimed`}</Link>
        </dd>
        <Change change={changes.claimed!} />
      </div>
    </>
  );
}

const CONCLUSIONS: { id: "gaps" | "undetermined" | "conforms" | "not_applicable" | "none"; label: string; tone: string }[] = [
  { id: "gaps", label: "Gaps found", tone: "error" },
  { id: "undetermined", label: "Undetermined", tone: "warning" },
  { id: "conforms", label: "Conforms", tone: "success" },
  { id: "not_applicable", label: "Not applicable", tone: "neutral" },
  { id: "none", label: "Not evaluated", tone: "none" },
];

/**
 * The Assessments card: how many there are, then the conclusion of each one's
 * latest completed Evaluation, as one bar split by conclusion and a legend
 * whose entries open the list's matching tab. Not applicable shows only above
 * zero.
 */
function AssessmentCard({ assessments, changes }: { assessments: FleetSummary["assessments"]; changes: Record<string, string> }) {
  const { total, byConclusion } = assessments;
  const shown = CONCLUSIONS.filter((conclusion) => conclusion.id !== "not_applicable" || byConclusion.not_applicable > 0);
  return (
    <div className={styles.card} data-figure="Assessments">
      <dt className={styles.cardLabel}>Assessments</dt>
      <dd className={styles.cardValue}>
        <Link href={assessmentsHref()}>{figure(total)}</Link>
      </dd>
      <Change change={changes.assessments!} />
      <dd className={styles.split} role="img" aria-label={shown.map((conclusion) => `${conclusion.label} ${byConclusion[conclusion.id]}`).join(", ")}>
        {shown.map((conclusion) => byConclusion[conclusion.id] > 0 && <span key={conclusion.id} data-tone={conclusion.tone} style={{ flexGrow: byConclusion[conclusion.id] }} />)}
      </dd>
      <dd className={styles.legendWrap}>
        <dl className={styles.legend} aria-label="By conclusion">
          {shown.map((conclusion) => (
            <div key={conclusion.id} data-figure={conclusion.label}>
              <dt>
                <span className={styles.swatch} data-tone={conclusion.tone} aria-hidden="true" />
                {conclusion.label}
              </dt>
              <dd>
                <Link href={assessmentsHref({ conclusion: conclusion.id })}>{figure(byConclusion[conclusion.id])}</Link>
              </dd>
            </div>
          ))}
        </dl>
      </dd>
    </div>
  );
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
