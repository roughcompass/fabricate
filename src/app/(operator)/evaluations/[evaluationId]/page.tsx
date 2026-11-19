import type { JsonObject } from "@repo-facts/contract";
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
import { param } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
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
import { releaseById, standardById } from "@/lib/standards/standard-records";
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

  const findings = filterFindings(db, evaluation.id, releases.map(({ pinned }) => pinned), query);
  const summaries = new Map(((summary?.releases ?? []) as JsonObject[]).map((entry) => [String(entry.release), entry]));
  const combined = (summary?.combined ?? null) as JsonObject | null;
  const conclusionOf = (entry: JsonObject | null | undefined) => CONCLUSIONS[(entry?.conclusion as Conclusion | undefined) ?? "not_applicable"];

  return (
    <Page>
      {!status.terminal && <ProgressPoller url={routes.evaluationStatus(evaluation.publicId)} version={status.version} />}
      <PageHeader
        breadcrumbs={[
          { href: "/assessments", label: "Assessments" },
          { href: routes.assessment(assessment.publicId), label: assessment.name },
        ]}
        title={name}
        status={<Status state={evaluation.state} />}
        meta={[
          <Link key="assessment" href={routes.run(run.publicId)}>{`Run #${found.runNumber}`}</Link>,
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
        ]}
        description="A diagnostic comparison of one Run with the Standard Releases pinned when the Evaluation started."
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
      />

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

      <FindingsSection evaluationId={evaluation.publicId} releases={releases} findings={findings} terminal={status.terminal} />

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
    </Page>
  );
}

/** The Findings, filtered by the address and grouped by Release and Control, each opening its own page. */
function FindingsSection({ evaluationId, releases, findings, terminal }: { evaluationId: string; releases: { pinned: EvaluationRelease; label: string }[]; findings: FilteredFindings; terminal: boolean }) {
  const { all, controls, subjects, filters, filtered, shown } = findings;
  const base = routes.evaluation(evaluationId);
  return (
    <Section id="findings" title="Findings" description="One Finding per Control and subject, grouped by Release and Control. Open a Finding for what was expected, what was observed, and why.">
      <FilterBar key={JSON.stringify(filters)} action={base} label="Filter Findings" filtered={filtered} clearHref={base}>
        <Select id="filter-release" name="release" label="Release" size="sm" defaultValue={filters.release ?? ""} options={[{ value: "", label: "Any Release" }, ...releases.map(({ pinned, label }) => ({ value: String(pinned.position), label }))]} />
        <Select id="filter-outcome" name="outcome" label="Outcome" size="sm" defaultValue={filters.outcome ?? ""} options={[{ value: "", label: "Any outcome" }, ...OUTCOME_ORDER.map((outcome) => ({ value: outcome, label: outcomeLabel(outcome) }))]} />
        <Select id="filter-severity" name="severity" label="Severity" size="sm" defaultValue={filters.severity ?? ""} options={[{ value: "", label: "Any severity" }, ...severityOptions(SEVERITIES)]} />
        <Select id="filter-control" name="control" label="Control" size="sm" defaultValue={filters.control ?? ""} options={[{ value: "", label: "Any Control" }, ...controls.map(([key, title]) => ({ value: key, label: title }))]} />
        <Select id="filter-subject" name="subject" label="Subject" size="sm" defaultValue={filters.subject ?? ""} options={[{ value: "", label: "Any subject" }, ...subjects.map(([key, subject]) => ({ value: key, label: subject }))]} />
      </FilterBar>
      <p role="status" className={styles.count}>
        {filtered ? `Showing ${shown.length} of ${countLabel(all.length, "Finding")}` : countLabel(all.length, "Finding")}
      </p>

      {shown.length === 0 && (
        <Panel flush>
          <EmptyState title={all.length === 0 ? "No Findings yet" : "No matching Findings"}>{all.length === 0 ? (terminal ? "This Evaluation produced no Findings." : "Findings appear as each Release is evaluated.") : "No Finding matches these filters."}</EmptyState>
        </Panel>
      )}

      {releases.map(({ pinned, label }) => {
        const group = shown.filter(({ finding }) => finding.evaluationReleaseId === pinned.id);
        if (!group.length) return null;
        const byControl = [...new Map(group.map(({ finding }) => [finding.controlKey, group.filter((item) => item.finding.controlKey === finding.controlKey)])).values()];
        return (
          <Section key={pinned.id} id={`release-${pinned.position}`} level={3} title={label} description={`${countLabel(byControl.length, "Control")} · ${countLabel(group.length, "Finding")}`}>
            <Panel flush>
              <ul className={styles.controls} aria-label={`${label} Controls`}>
                {byControl.map((items) => {
                  const { finding, document } = items[0]!;
                  const control = document.control as JsonObject;
                  const counts = OUTCOME_ORDER.map((outcome) => [outcome, items.filter((item) => item.finding.outcome === outcome).length] as const).filter(([, count]) => count > 0);
                  return (
                    <li key={finding.controlKey}>
                      <details className={styles.control} open={filtered}>
                        <summary className={styles.summary}>
                          <Icon name="chevronRight" size={14} className={styles.chevron} />
                          <span className={styles.title}>
                            <span className={styles.controlTitle}>{String(control.title)}</span>
                            <Tag>{finding.controlKey}</Tag>
                          </span>
                          <Severity value={finding.severity} />
                          <span className={styles.counts}>
                            {counts.map(([outcome, count]) => (
                              <Status key={outcome} state={outcome} size="sm" label={`${count} ${statusLabel(outcome)}`} />
                            ))}
                          </span>
                        </summary>
                        <Table
                          label={`${String(control.title)} Findings`}
                          head={
                            <>
                              <Th>Subject</Th>
                              <Th>Outcome</Th>
                            </>
                          }
                        >
                          {items.map((item) => (
                            <tr key={item.finding.publicId}>
                              <Td label="Subject">
                                <Link href={routes.finding(evaluationId, item.finding.publicId)}>{String((item.document.subject as JsonObject).name)}</Link>
                              </Td>
                              <Td label="Outcome">
                                <Status state={item.finding.outcome as Outcome} />
                              </Td>
                            </tr>
                          ))}
                        </Table>
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

