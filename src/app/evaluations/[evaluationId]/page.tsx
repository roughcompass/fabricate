import type { JsonObject } from "@repo-facts/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ProgressPoller } from "@/components/progress-poller";
import styles from "@/components/results/results.module.css";
import { Badge, StatusBadge, type Tone } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import type { IconName } from "@/components/ui/icon";
import { Timestamp, countLabel } from "@/components/ui/format";
import { Select } from "@/components/ui/form";
import { Card, DetailsList, Page, PageHeader, Stat, ui } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { assessmentById } from "@/lib/assessments/lookups";
import { evaluationStatus } from "@/lib/assessments/status";
import { getDb } from "@/lib/db/client";
import { OUTCOMES, SEVERITIES, initiatives } from "@/lib/db/schema";
import type { Outcome } from "@/lib/evaluations/controls";
import { coverageGapsOf, evaluationReleasesOf, findEvaluation, findingDocument, findingsOf, outcomeLabel } from "@/lib/evaluations/evaluation-records";
import { type Conclusion, OUTCOME_ORDER } from "@/lib/evaluations/summary";
import { releaseById, standardById } from "@/lib/standards/standard-records";
import { parseCanonical } from "@repo-facts/contract";

export const metadata: Metadata = { title: "Evaluation" };

const CONCLUSIONS: Record<Conclusion, [Tone, IconName, string]> = {
  gaps: ["error", "xCircle", "Gaps found"],
  undetermined: ["warning", "help", "Undetermined"],
  conforms: ["success", "checkCircle", "Conforms"],
  not_applicable: ["neutral", "minus", "Not applicable"],
};

const capitalized = (text: string) => text[0]!.toUpperCase() + text.slice(1);

const SEVERITY_ORDER = [...SEVERITIES].reverse();

const NOTICES: Record<string, [tone: "success" | "info", message: string]> = {
  started: ["success", "The Evaluation was started. It reads the Assessment's stored results and never re-analyzes a repository."],
  "already-started": ["info", "This Evaluation was already started; no duplicate was created."],
};

function pick<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export default async function EvaluationPage({ params, searchParams }: { params: Promise<{ evaluationId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ evaluationId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const evaluation = findEvaluation(db, evaluationId);
  if (!evaluation) notFound();

  const initiative = db.select().from(initiatives).where(eq(initiatives.id, evaluation.initiativeId)).get()!;
  const assessment = assessmentById(db, evaluation.assessmentId);
  const status = evaluationStatus(db, evaluation);
  const gaps = coverageGapsOf(evaluation);
  const summary = evaluation.summary ? (parseCanonical(evaluation.summary) as JsonObject) : null;
  const releases = evaluationReleasesOf(db, evaluation.id).map((pinned) => {
    const release = releaseById(db, pinned.standardReleaseId);
    const standard = standardById(db, release.standardId);
    return { pinned, release, standard, label: `${standard.name} v${release.version}` };
  });

  const all = findingsOf(db, evaluation.id).map((finding) => ({ finding, document: findingDocument(finding) }));
  const controls = [...new Map(all.map(({ finding, document }) => [finding.controlKey, String((document.control as JsonObject).title)])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const subjects = [...new Map(all.map(({ finding, document }) => [finding.subjectKey, String((document.subject as JsonObject).name)])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const filters = {
    release: pick(query.release, releases.map(({ pinned }) => String(pinned.position))),
    outcome: pick(query.outcome, OUTCOMES),
    severity: pick(query.severity, SEVERITIES),
    control: pick(query.control, controls.map(([key]) => key)),
    subject: pick(query.subject, subjects.map(([key]) => key)),
  };
  const filtered = Object.values(filters).some(Boolean);
  const shown = all.filter(
    ({ finding }) =>
      (!filters.release || releases.find(({ pinned }) => pinned.id === finding.evaluationReleaseId)?.pinned.position === Number(filters.release)) &&
      (!filters.outcome || finding.outcome === filters.outcome) &&
      (!filters.severity || finding.severity === filters.severity) &&
      (!filters.control || finding.controlKey === filters.control) &&
      (!filters.subject || finding.subjectKey === filters.subject),
  );
  const base = `/evaluations/${evaluation.publicId}`;
  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const summaries = new Map(((summary?.releases ?? []) as JsonObject[]).map((entry) => [String(entry.release), entry]));

  return (
    <Page>
      {!status.terminal && <ProgressPoller url={`/api/evaluations/${evaluation.publicId}/status`} version={status.version} />}
      <PageHeader
        title={`Evaluation ${evaluation.publicId}`}
        back={{ href: `/initiatives/${initiative.publicId}`, label: initiative.name }}
        badge={<StatusBadge state={evaluation.state} />}
        description="A diagnostic comparison of one Assessment with the Standard Releases pinned when the Evaluation started. Findings never change after they are written."
      />

      {notice && (
        <Notice tone={notice[0]} live>
          {notice[1]}
        </Notice>
      )}
      {evaluation.state === "failed" && (
        <Notice tone="warning" title="The Evaluation failed">
          {evaluation.failureReason ?? "It could not finish."}
        </Notice>
      )}
      {gaps.length > 0 && (
        <Notice tone="warning" title={`${countLabel(gaps.length, "repository", "repositories")} in the Assessment had no Profile`}>
          What those repositories could contain is unknown, so Controls that depend on it are Indeterminate rather than Meets or Gap.
        </Notice>
      )}

      <Card title="Inputs">
        <DetailsList
          items={[
            [
              "Assessment",
              <Link key="assessment" href={`/assessments/${assessment.publicId}`}>
                <Mono>{assessment.publicId}</Mono>
              </Link>,
            ],
            [
              "Releases",
              <ul key="releases" className={ui.plainList}>
                {releases.map(({ pinned, release, standard, label }) => (
                  <li key={pinned.id}>
                    <Link href={`/standards/${standard.publicId}/releases/${release.publicId}`}>{label}</Link> <StatusBadge state={pinned.state} />
                  </li>
                ))}
              </ul>,
            ],
            ["Evaluator version", <Mono key="evaluator">{evaluation.evaluatorVersion}</Mono>],
            ["Started", <Timestamp key="started" value={evaluation.startedAt} />],
            ["Finished", <Timestamp key="finished" value={evaluation.finishedAt} />],
          ]}
        />
      </Card>

      {summary && (
        <Card title="Summary" description="Each Release is concluded separately. Indeterminate and Not applicable are never counted as Gap or Meets." flush>
          <div className={styles.cardSection}>
            <div className={ui.stats}>
              {OUTCOME_ORDER.map((outcome) => (
                <Stat key={outcome} label={outcomeLabel(outcome)} value={Number(((summary.combined as JsonObject).counts as JsonObject)[outcome])} />
              ))}
            </div>
          </div>
          <Table
            label="Summary by Release"
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
            {releases.map(({ pinned, release, label }) => {
              const entry = summaries.get(release.publicId);
              const counts = (entry?.counts ?? {}) as JsonObject;
              const [tone, icon, text] = CONCLUSIONS[(entry?.conclusion as Conclusion | undefined) ?? "not_applicable"];
              return (
                <tr key={pinned.id}>
                  <Td label="Release">
                    <Primary>{label}</Primary>
                  </Td>
                  <Td label="Conclusion">
                    <Badge tone={tone} icon={icon}>
                      {text}
                    </Badge>
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
        </Card>
      )}

      <div id="findings">
        <Card title="Findings" description="One Finding per Control and subject. Open a Finding for its expected state, observed facts, evidence, and reasoning.">
          <form key={JSON.stringify(filters)} method="get" action={base} className={styles.filters} aria-label="Filter Findings">
            <Select id="filter-release" name="release" label="Release" defaultValue={filters.release ?? ""} options={[{ value: "", label: "Any Release" }, ...releases.map(({ pinned, label }) => ({ value: String(pinned.position), label }))]} />
            <Select id="filter-outcome" name="outcome" label="Outcome" defaultValue={filters.outcome ?? ""} options={[{ value: "", label: "Any outcome" }, ...OUTCOME_ORDER.map((outcome) => ({ value: outcome, label: outcomeLabel(outcome) }))]} />
            <Select id="filter-severity" name="severity" label="Severity" defaultValue={filters.severity ?? ""} options={[{ value: "", label: "Any severity" }, ...SEVERITY_ORDER.map((severity) => ({ value: severity, label: capitalized(severity) }))]} />
            <Select id="filter-control" name="control" label="Control" defaultValue={filters.control ?? ""} options={[{ value: "", label: "Any Control" }, ...controls.map(([key, title]) => ({ value: key, label: title }))]} />
            <Select id="filter-subject" name="subject" label="Subject" defaultValue={filters.subject ?? ""} options={[{ value: "", label: "Any subject" }, ...subjects.map(([key, name]) => ({ value: key, label: name }))]} />
            <div className={styles.filterActions}>
              <Button type="submit" variant="primary">
                Apply filters
              </Button>
              {filtered && <ButtonLink href={`${base}#findings`}>Clear filters</ButtonLink>}
            </div>
          </form>
          <p role="status">{filtered ? `Showing ${shown.length} of ${countLabel(all.length, "Finding")}` : countLabel(all.length, "Finding")}</p>
          {all.length === 0 && <p className={ui.muted}>{status.terminal ? "This Evaluation produced no Findings." : "Findings appear as each Release is evaluated."}</p>}
          {all.length > 0 && shown.length === 0 && <p className={ui.muted}>No Finding matches these filters.</p>}
        </Card>
      </div>

      {releases.map(({ pinned, label }) => {
        const group = shown.filter(({ finding }) => finding.evaluationReleaseId === pinned.id);
        if (!group.length) return null;
        return (
          <div key={pinned.id} id={`release-${pinned.position}`}>
            <Card title={label} description={countLabel(group.length, "Finding")} flush>
              <Table
                label={`${label} Findings`}
                head={
                  <>
                    <Th>Control</Th>
                    <Th>Subject</Th>
                    <Th>Severity</Th>
                    <Th>Outcome</Th>
                  </>
                }
              >
                {group.map(({ finding, document }) => (
                  <tr key={finding.publicId}>
                    <Td label="Control">
                      <Link href={`${base}/findings/${finding.publicId}`}>{String((document.control as JsonObject).title)}</Link>
                      <Secondary mono>{finding.controlKey}</Secondary>
                    </Td>
                    <Td label="Subject">{String((document.subject as JsonObject).name)}</Td>
                    <Td label="Severity">{capitalized(finding.severity)}</Td>
                    <Td label="Outcome">
                      <StatusBadge state={finding.outcome as Outcome} />
                    </Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        );
      })}
    </Page>
  );
}
