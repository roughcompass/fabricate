import type { JsonObject } from "@repo-facts/contract";
import { DetailsTemplate } from "@/components/templates/details-template";
import { parseCanonical } from "@repo-facts/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ProgressPoller } from "@/components/progress-poller";
import { Alert } from "@/components/ui/alert";
import { countLabel } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { type Query, type SearchParams, param, withQuery } from "@/lib/web/query";
import { ControlOpener } from "./control-opener";
import { SearchField } from "@/components/ui/search-field";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { StatGroup } from "@/components/ui/stat-group";
import { Severity, Status, severityOptions, statusLabel } from "@/components/ui/status";
import { Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { runNumber } from "@/lib/runs/run-records";
import { runById } from "@/lib/runs/lookups";
import { evaluationStatus } from "@/lib/runs/status";
import { getDb } from "@/lib/db/client";
import type { Outcome } from "@/lib/evaluations/controls";
import { coverageGapsOf, evaluationNumber, type EvaluationRelease, evaluationReleasesOf, findEvaluation, outcomeLabel, SEVERITIES } from "@/lib/evaluations/evaluation-records";
import { type Conclusion, OUTCOME_ORDER } from "@/lib/evaluations/summary";
import { assessmentById } from "@/lib/assessments/assessment-records";
import { releaseById, releaseDocument, standardById } from "@/lib/standards/standard-records";
import { evaluationOutcome } from "../outcomes";
import styles from "./evaluation.module.css";
import { routes } from "@/lib/web/routes";
import { type FilteredFindings, filterFindings } from "@/lib/evaluations/finding-filters";

const CONCLUSIONS: Record<Conclusion, string> = { gaps: "gaps", undetermined: "undetermined", conforms: "conforms", not_applicable: "not_applicable" };

const load = cache((publicId: string) => {
  const db = getDb();
  const evaluation = findEvaluation(db, publicId);
  if (!evaluation) return undefined;
  const run = runById(db, evaluation.runId);
  return { evaluation, run, assessment: assessmentById(db, evaluation.assessmentId), number: evaluationNumber(db, evaluation), runNumber: runNumber(db, run) };
});

export async function generateMetadata({ params }: PageProps<"/evaluations/[evaluationId]">): Promise<Metadata> {
  const found = load((await params).evaluationId);
  return { title: found ? `Evaluation #${found.number} · ${found.assessment.name}` : "Evaluation not found" };
}

export default async function EvaluationPage({ params, searchParams }: PageProps<"/evaluations/[evaluationId]">) {
  const [{ evaluationId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const found = load(evaluationId);
  if (!found) notFound();
  const { evaluation, run, assessment, number } = found;
  const name = `Evaluation #${number}`;
  const status = evaluationStatus(db, evaluation);
  const gaps = coverageGapsOf(evaluation);
  const summary = evaluation.summary ? (parseCanonical(evaluation.summary) as JsonObject) : null;
  const releases = evaluationReleasesOf(db, evaluation.id).map((pinned) => {
    const release = releaseById(db, pinned.standardReleaseId);
    const standard = standardById(db, release.standardId);
    return { pinned, release, standard, label: `${standard.name} v${release.version}` };
  });
  const evaluated = releases.filter(({ pinned }) => pinned.state === "complete" || pinned.state === "failed").length;

  // Each Release's Control titles, from its one document, so the Findings list reads no Finding document.
  const pinnedReleases = releases.map(({ pinned, release }) => ({ id: pinned.id, position: pinned.position, titles: controlTitles(releaseDocument(release)) }));
  const findings = filterFindings(db, evaluation.id, pinnedReleases, query, (position, key) => param(query, findingsPageParam(position, key)));
  const summaries = new Map(((summary?.releases ?? []) as JsonObject[]).map((entry) => [String(entry.release), entry]));
  const combined = (summary?.combined ?? null) as JsonObject | null;
  const conclusionOf = (entry: JsonObject | null | undefined) => CONCLUSIONS[(entry?.conclusion as Conclusion | undefined) ?? "not_applicable"];

  return (
    <DetailsTemplate
      header={{
        // One chain: Assessment, Run, Evaluation, Finding.
        breadcrumbs: [
          { href: "/assessments", label: "Assessments" },
          { href: routes.assessment(assessment.publicId), label: assessment.name },
          { href: routes.run(run.publicId), label: `Run #${found.runNumber}` },
        ],
        title: name,
        status: <Status state={evaluation.state} />,
        // The Run is the last breadcrumb, so the meta row doesn't repeat it.
        meta: [
          countLabel(releases.length, "Release"),
          <span key="started">
            Started <RelativeTime value={evaluation.createdAt} />
          </span>,
          ...(evaluation.finishedAt
            ? [
                <span key="finished">
                  Finished <RelativeTime value={evaluation.finishedAt} />
                </span>,
              ]
            : []),
        ],
      }}
      alerts={
        <>
          <OutcomeToast outcome={evaluationOutcome(param(query, "notice"), evaluation, name)} />
          {evaluation.state === "failed" && (
            <Alert tone="error" title="The Evaluation failed">
              {evaluation.failureReason ?? "It could not finish."}
            </Alert>
          )}
          {gaps.length > 0 && (
            <Alert tone="warning" title={`${countLabel(gaps.length, "repository", "repositories")} in the Run had no Profile`}>
              {gaps.length === 1
                ? "What it could contain is unknown, so Controls that depend on it are Indeterminate rather than Meets or Gap."
                : "What they could contain is unknown, so Controls that depend on them are Indeterminate rather than Meets or Gap."}
            </Alert>
          )}
        </>
      }
    >
      {!status.terminal && <ProgressPoller url={routes.evaluationStatus(evaluation.publicId)} version={status.version} />}

      <Section title="Overview" description={releases.length > 1 ? "Each Release is concluded separately; Indeterminate and Not applicable never count as Gap or Meets." : "Indeterminate and Not applicable never count as Gap or Meets."}>
        {!status.terminal && <ProgressBar value={evaluated} max={releases.length} label={`${evaluated} of ${countLabel(releases.length, "Release")} evaluated`} />}
        {combined && (
          <StatGroup
            label="Outcomes"
            stats={[
              ...(releases.length === 1 ? [{ label: "Conclusion", value: <Status state={conclusionOf(summaries.get(releases[0]!.release.publicId))} /> }] : []),
              ...OUTCOME_ORDER.map((outcome) => ({ label: outcomeLabel(outcome), value: Number((combined.counts as JsonObject)[outcome]) })),
            ]}
          />
        )}
        {summary && releases.length > 1 && (
          <Panel flush>
            <Table
              label="Summary by Release"
              scroll
              head={
                <>
                  <Th>Release</Th>
                  <Th>Conclusion</Th>
                  {OUTCOME_ORDER.map((outcome) => (
                    <Th key={outcome} align="numeric">
                      {outcomeLabel(outcome)}
                    </Th>
                  ))}
                </>
              }
            >
              {releases.map(({ pinned, release, standard, label }) => {
                const entry = summaries.get(release.publicId);
                const counts = (entry?.counts ?? {}) as JsonObject;
                return (
                  <tr key={pinned.id}>
                    <Td label="Release">
                      <Link href={routes.release(standard.publicId, release.publicId)}>{label}</Link>
                    </Td>
                    <Td label="Conclusion">
                      <Status state={conclusionOf(entry)} />
                    </Td>
                    {OUTCOME_ORDER.map((outcome) => (
                      <Td key={outcome} label={outcomeLabel(outcome)} align="numeric">
                        {Number(counts[outcome] ?? 0)}
                      </Td>
                    ))}
                  </tr>
                );
              })}
            </Table>
          </Panel>
        )}
      </Section>

      <FindingsSection evaluationId={evaluation.publicId} releases={releases} findings={findings} terminal={status.terminal} query={query} />

      <Disclosure summary="Details" variant="plain">
        <DescriptionList surface
          items={[
            ["Evaluator version", <Tag key="evaluator">{evaluation.evaluatorVersion}</Tag>],
            ["Started", <RelativeTime key="started" value={evaluation.startedAt} />],
            ["Finished", <RelativeTime key="finished" value={evaluation.finishedAt} />],
            ["ID", <Tag key="id" copy label="ID">{evaluation.publicId}</Tag>],
          ]}
        />
      </Disclosure>
    </DetailsTemplate>
  );
}

/**
 * The address parameter of one Control's page of Findings, by the Release's
 * position in the Evaluation and the Control's key, such as `page_0_has-ci` for the first Release:
 * both are fixed for the Evaluation, so a paged Control keeps its address.
 */
const findingsPageParam = (position: number, controlKey: string) => `page_${position}_${controlKey}`;

/**
 * Up to this many Findings, every Control carries its first page, collapsed
 * or not. Beyond it, as with a fleet's Evaluation, a Control carries its
 * Findings only once opened, by its page in the address, so the page stays
 * fast however many it holds.
 */
const INLINE_FINDINGS = 200;

/** A Release's Control titles by key. */
function controlTitles(document: JsonObject): Map<string, string> {
  const controls = Array.isArray(document.controls) ? (document.controls as JsonObject[]) : [];
  return new Map(controls.map((control) => [String(control.key), String(control.title)]));
}

/** The Findings, filtered by the address and grouped by Release and Control, each opening its own page; a Control with more than 50 pages its own. */
function FindingsSection({ evaluationId, releases, findings, terminal, query }: { evaluationId: string; releases: { pinned: EvaluationRelease; label: string }[]; findings: FilteredFindings; terminal: boolean; query: SearchParams }) {
  const { total, shown, controls, subjects, filters, filtered, byRelease } = findings;
  const base = routes.evaluation(evaluationId);
  // A page link keeps the filters and every other Control's page; the filter form sends only the filters, so changing one returns each Control to its first page.
  const current: Query = Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const { subject: _subject, ...withoutSubject } = filters;
  return (
    <Section id="findings" title="Findings" description="One Finding per Control and subject, grouped by Release and Control; each says what was expected, what was observed, and why.">
      <FilterBar key={JSON.stringify(filters)} action={base} label="Filter Findings" filtered={filtered} clearHref={base}>
        <Select id="filter-release" name="release" label="Release" size="sm" defaultValue={filters.release ?? ""} options={[{ value: "", label: "Any Release" }, ...releases.map(({ pinned, label }) => ({ value: String(pinned.position), label }))]} />
        <Select id="filter-outcome" name="outcome" label="Outcome" size="sm" defaultValue={filters.outcome ?? ""} options={[{ value: "", label: "Any outcome" }, ...OUTCOME_ORDER.map((outcome) => ({ value: outcome, label: outcomeLabel(outcome) }))]} />
        <Select id="filter-severity" name="severity" label="Severity" size="sm" defaultValue={filters.severity ?? ""} options={[{ value: "", label: "Any severity" }, ...severityOptions(SEVERITIES)]} />
        <Select id="filter-control" name="control" label="Control" size="sm" defaultValue={filters.control ?? ""} options={[{ value: "", label: "Any Control" }, ...controls.map(([key, title]) => ({ value: key, label: title }))]} />
        {/* A fleet has hundreds of subjects, too many for a select: the field keeps the subjects whose name contains its text, and suggests their names. */}
        <SearchField id="filter-subject" name="subject" label="Subject" size="sm" placeholder="Any subject" defaultValue={filters.subject ?? ""} list="filter-subject-names" clearHref={withQuery(base, withoutSubject)} />
        <datalist id="filter-subject-names">
          {subjects.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </FilterBar>
      <p role="status" className={styles.count}>
        {filtered ? `Showing ${shown} of ${countLabel(total, "Finding")}` : countLabel(total, "Finding")}
      </p>

      {shown === 0 && (
        <Panel flush>
          <EmptyState title={total === 0 ? "No Findings yet" : "No matching Findings"}>{total === 0 ? (terminal ? "This Evaluation produced no Findings." : "Findings appear as each Release is evaluated.") : "No Finding matches these filters."}</EmptyState>
        </Panel>
      )}

      {releases.map(({ pinned, label }) => {
        const list = byRelease.get(pinned.position);
        if (!list) return null;
        return (
          <Section key={pinned.id} id={`release-${pinned.position}`} level={3} title={label} description={`${countLabel(list.length, "Control")} · ${countLabel(list.reduce((sum, control) => sum + control.total, 0), "Finding")}`}>
            <Panel flush>
              <ul className={styles.controls} aria-label={`${label} Controls`}>
                {list.map((control) => {
                  const pageParam = findingsPageParam(pinned.position, control.key);
                  const requested = param(query, pageParam);
                  // Inline while the Findings are few; otherwise only while the address opens it.
                  const carried = shown <= INLINE_FINDINGS || requested !== undefined;
                  const anchor = `control-${pinned.position}-${control.key}`;
                  return (
                    <li key={control.key} id={anchor} className={styles.controlItem}>
                      {/* Open while filtered to a few Findings, and on a page the address names, so a page link lands on the Findings it shows. */}
                      <details className={styles.control} open={(filtered && shown <= INLINE_FINDINGS) || requested !== undefined}>
                        <summary className={styles.summary}>
                          <Icon name="chevronRight" size={14} className={styles.chevron} />
                          <span className={styles.title}>
                            <span className={styles.controlTitle}>{control.title}</span>
                            <Tag>{control.key}</Tag>
                          </span>
                          <Severity value={control.severity} />
                          <span className={styles.counts}>
                            {control.counts.map(([outcome, count]) => (
                              <Status key={outcome} state={outcome} size="sm" label={`${count} ${statusLabel(outcome)}`} />
                            ))}
                          </span>
                        </summary>
                        {carried ? (
                          <>
                            <Table
                              label={`${control.title} Findings`}
                              head={
                                <>
                                  <Th>Subject</Th>
                                  <Th>Outcome</Th>
                                </>
                              }
                            >
                              {control.rows.map((row) => (
                                <tr key={row.publicId}>
                                  <Td label="Subject">
                                    {/* The link opens the Finding, named by its Control and subject. */}
                                    <Link href={routes.finding(evaluationId, row.publicId)} aria-label={`${control.title}: ${row.subject}`}>
                                      {row.subject}
                                    </Link>
                                  </Td>
                                  <Td label="Outcome">
                                    <Status state={row.outcome as Outcome} />
                                  </Td>
                                </tr>
                              ))}
                            </Table>
                            {control.pages > 1 && (
                              <div className={styles.pages}>
                                {/* Every page names its number, the first too, so paging back keeps the Control open. */}
                                <Pagination label={`${control.title} Findings pages`} page={control.page} pages={control.pages} href={(number) => withQuery(base, { ...current, [pageParam]: number }, anchor)} scrollToTop />
                              </div>
                            )}
                          </>
                        ) : (
                          <ControlOpener href={withQuery(base, { ...current, [pageParam]: 1 }, anchor)} label={`Show its ${countLabel(control.total, "Finding")}`} />
                        )}
                      </details>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </Section>
        );
      })}
    </Section>
  );
}
