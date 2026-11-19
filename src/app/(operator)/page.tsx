import type { Metadata } from "next";
import Link from "next/link";
import { DashboardPanel, DashboardTemplate } from "@/components/templates/dashboard-template";
import { ButtonLink } from "@/components/ui/button";
import { countLabel, formatNumber, percentOf } from "@/components/ui/count";
import { EmptyState } from "@/components/ui/empty-state";
import { pageNumber, param } from "@/lib/web/query";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { toneClass } from "@/components/ui/indicator";
import { StateIndicator, Status, statusLabel, statusOf } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { getDb } from "@/lib/db/client";
import { browserTitle } from "@/lib/product";
import { profilingActivity } from "@/lib/profiling/versions";
import { BarChart, type BarSeries } from "@/components/ui/bar-chart";
import { ATTENTION_PAGE_SIZE, type AttentionItem, attentionItems } from "@/lib/home/attention";
import { type ActivityKind, WEEK_MS, assessmentTrend, figureChanges, figuresAt, recentActivity } from "@/lib/home/dashboard";
import { type FleetSummary, fleetSummary } from "@/lib/home/summary";
import { assessmentsHref, repositoriesHref } from "@/lib/web/list-filters";
import styles from "./home.module.css";
import { routes } from "@/lib/web/routes";
import { formatShortDate } from "@/components/ui/time";
import { CONCLUSION_FILTERS, conclusionState } from "@/lib/evaluations/conclusions";

// The root layout's title template applies only to child segments, and this page shares the root segment.
export const metadata: Metadata = { title: { absolute: browserTitle("Home") } };

/** The time this request renders, which each figure's change over the week is measured from. */
function requestTime(): number {
  return Date.now();
}

/**
 * Home (home spec), a Dashboard read in the order a person acts: the actions
 * that start work, in the header; what needs someone, first; then where the
 * fleet stands, as figure cards that each open the list they count, with the
 * share they cover and their change over the last seven days; then the
 * Assessment trend beside the latest finished Runs. Each part reads its own
 * figures, so one that fails shows its error and the others render. Every
 * visitor sees the same page.
 */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  return (
    <DashboardTemplate
      header={{
        title: "Home",
        description: "What needs attention, where the fleet's Repositories and Assessments stand, and what changed this week.",
        primaryAction: (
          <ButtonLink href="/assessments/new" variant="primary" icon="plus">
            New Assessment
          </ButtonLink>
        ),
        secondaryActions: [{ href: "/repositories/bulk", label: "Add Repositories", icon: "layers" }],
      }}
      attention={<NeedsAttention requested={param(query, "page")} />}
      figures={<FleetFigures />}
    >
      <DashboardPanel title="Assessment trend" description="Evaluations completed each week, by conclusion, over the last eight weeks." link={{ href: assessmentsHref(), label: "All Assessments" }}>
        {assessmentTrendPanel}
      </DashboardPanel>
      <DashboardPanel title="Recent activity" description="The latest finished Runs." link={{ href: assessmentsHref(), label: "All Assessments" }} flush>
        {recentActivityPanel}
      </DashboardPanel>
    </DashboardTemplate>
  );
}

/** What needs someone, newest first, twenty to a page; nothing to do takes one line, so it never pushes the figures down. */
function NeedsAttention({ requested }: { requested: string | undefined }) {
  const items = attentionItems(getDb());
  const { page, pages } = pageNumber(requested, items.length, ATTENTION_PAGE_SIZE);
  const shown = items.slice((page - 1) * ATTENTION_PAGE_SIZE, page * ATTENTION_PAGE_SIZE);
  return (
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
              <AttentionRow key={`${item.kind}-${"run" in item ? item.run.publicId : item.evaluation.publicId}`} item={item} />
            ))}
          </Table>
        ) : (
          <div className={styles.clear}>
            <Status state="clear" label="Nothing needs attention" />
            <span className={styles.muted}>{"Home checks each Assessment's latest Run and Evaluation."}</span>
          </div>
        )}
      </Panel>
      <Pagination label="Needs attention pages" page={page} pages={pages} href={(number) => (number === 1 ? "/#needs-attention" : `/?page=${number}#needs-attention`)} />
    </div>
  );
}

/** Where the fleet stands: the Repositories cards beside the Assessments card, or each group's empty state. */
function FleetFigures() {
  const db = getDb();
  const summary = fleetSummary(db);
  const profiling = profilingActivity(db);
  const changes = figureChanges(summary, figuresAt(db, new Date(requestTime() - WEEK_MS)));
  return (
    <div className={styles.overview}>
      <section className={styles.group} data-group="repositories" aria-label="Repositories">
        {summary.repositories.empty ? (
          <Panel title="Repositories" description="Every Repository, each profiled in the background.">
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
              Register Git repositories to profile and assess them.
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
  );
}

/** Eight weeks of completed Evaluations by conclusion, read when its panel renders. */
function assessmentTrendPanel(): React.ReactNode {
  const trend = assessmentTrend(getDb());
  return (
    <BarChart
      id="assessment-trend"
      label="Evaluations completed each week, by conclusion"
      groupLabel="Week of"
      series={TREND_SERIES}
      groups={trend.map((week) => ({ label: formatShortDate(week.start), values: week.counts }))}
      empty="No Evaluation completed in the last eight weeks."
    />
  );
}

/** The latest finished Runs, each with its outcome as a status dot, read when its panel renders. */
function recentActivityPanel(): React.ReactNode {
  const activity = recentActivity(getDb()).slice(0, ACTIVITY_SHOWN);
  if (activity.length === 0) return <EmptyState title="Nothing has happened yet">Finished Runs appear here.</EmptyState>;
  return (
    <ol className={styles.activity} aria-label="Recent activity">
      {activity.map((item) => (
        <li key={`${item.kind}-${item.record.href}-${item.at.getTime()}`} data-activity={item.kind}>
          <span className={styles.activityWhat}>
            <Status state={item.kind === "run_failed" ? "failed" : "complete"}>
              <span className="visually-hidden">{ACTIVITY_LABELS[item.kind]} </span>
              <Link href={item.record.href}>{item.record.name}</Link>
            </Status>
          </span>
          <span className={styles.muted}>
            <RelativeTime value={item.at} />
          </span>
        </li>
      ))}
    </ol>
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
    <dd className={styles.meter} role="img" aria-label={`${label}: ${percentOf(value, max)}%`}>
      <span className={styles.meterFill} style={{ inlineSize: `${percentOf(value, max)}%` }} />
    </dd>
  );
}

/**
 * The Repositories cards: how many there are and how many are profiled, with
 * the profiled share of all as a bar. The count opens the list it counts.
 */
function RepositoryCards({ repositories, profiling, changes }: { repositories: FleetSummary["repositories"]; profiling: number; changes: Record<string, string> }) {
  const { total, profiled } = repositories;
  return (
    <>
      <div className={styles.card} data-figure="Repositories" data-key-figure="">
        <dt className={styles.cardLabel}>Repositories</dt>
        <dd className={styles.cardValue}>
          <Link href={repositoriesHref()}>{formatNumber(total)}</Link>
        </dd>
        <dd className={styles.muted}>Registered</dd>
        <Change change={changes.repositories!} />
      </div>
      <div className={styles.card} data-figure="Profiled" data-key-figure="">
        <dt className={styles.cardLabel}>Profiled</dt>
        {/* A count, not a link: the Repositories list can't be filtered to the profiled ones. */}
        <dd className={styles.cardValue}>
          {formatNumber(profiled)}
          <span className={styles.cardOf}>{`of ${formatNumber(total)}`}</span>
        </dd>
        <Meter value={profiled} max={total} label="Profiled" />
        <dd className={styles.muted}>{profiling > 0 ? `${formatNumber(profiling)} profiling or queued now` : profiled === total ? "Every Repository has a profile" : "Each is profiled in the background"}</dd>
      </div>
    </>
  );
}

// Each conclusion's filter, and its state in the status registry, which gives its label, tone, and indicator.
const CONCLUSIONS = CONCLUSION_FILTERS.map((id) => ({ id, state: conclusionState(id) }));

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
    <div className={styles.card} data-figure="Assessments" data-key-figure="">
      <dt className={styles.cardLabel}>Assessments</dt>
      <dd className={styles.cardValue}>
        <Link href={assessmentsHref()}>{formatNumber(total)}</Link>
      </dd>
      <Change change={changes.assessments!} />
      <dd className={styles.split} role="img" aria-label={shown.map((conclusion) => `${statusLabel(conclusion.state)} ${byConclusion[conclusion.id]}`).join(", ")}>
        {shown.map((conclusion) => byConclusion[conclusion.id] > 0 && <span key={conclusion.id} className={toneClass} data-tone={statusOf(conclusion.state).tone} style={{ flexGrow: byConclusion[conclusion.id] }} />)}
      </dd>
      <dd className={styles.legendWrap}>
        <dl className={styles.legend} aria-label="By conclusion">
          {shown.map((conclusion) => (
            <div key={conclusion.id} data-figure={statusLabel(conclusion.state)}>
              <dt>
                <StateIndicator state={conclusion.state} />
                {statusLabel(conclusion.state)}
              </dt>
              <dd>
                <Link href={assessmentsHref({ conclusion: conclusion.id })}>{formatNumber(byConclusion[conclusion.id])}</Link>
              </dd>
            </div>
          ))}
        </dl>
      </dd>
    </div>
  );
}

/** One problem: what it is, linked to the page that shows it; the record it concerns; and when it began. */
function AttentionRow({ item }: { item: AttentionItem }) {
  const { title, href, detail, record } = describe(item);
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

function describe(item: AttentionItem): { title: string; href: string; detail?: React.ReactNode; record: string } {
  switch (item.kind) {
    case "run_failed":
      return { title: `Run #${item.run.number} failed`, href: routes.run(item.run.publicId), record: item.assessment.name };
    case "run_with_issues":
      return { title: `Run #${item.run.number} couldn't assess ${countLabel(item.unassessed, "Repository", "Repositories")}`, href: routes.run(item.run.publicId), record: item.assessment.name };
    case "evaluation_failed":
      return { title: `Evaluation #${item.evaluation.number} failed`, href: routes.evaluation(item.evaluation.publicId), record: item.assessment.name };
  }
}
