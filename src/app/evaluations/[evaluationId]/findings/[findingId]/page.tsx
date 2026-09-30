import type { JsonObject } from "@repo-facts/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ExpressionView } from "@/app/standards/control-view";
import { EvidenceList } from "@/components/results/evidence";
import styles from "@/components/results/results.module.css";
import { TraceView } from "@/components/results/trace";
import { StatusBadge } from "@/components/ui/badge";
import { ShortSha } from "@/components/ui/format";
import { Card, DetailsList, Page, PageHeader, ui } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono } from "@/components/ui/table";
import { assessmentById } from "@/lib/assessments/lookups";
import { getDb } from "@/lib/db/client";
import { findings } from "@/lib/db/schema";
import { findEvaluation, findingDocument } from "@/lib/evaluations/evaluation-records";
import type { TraceNode } from "@/lib/evaluations/interpreter";
import { releaseById, standardById } from "@/lib/standards/standard-records";
import { COLLECTION_BY_ID, SELECTOR_BY_ID } from "@/lib/standards/registry";

export const metadata: Metadata = { title: "Finding" };

type Cause = { selector: string | null; parameter: string | null; collection: string | null; reason: string };

function causeSubject(cause: Cause): string {
  if (cause.selector) return `${SELECTOR_BY_ID.get(cause.selector)?.label ?? cause.selector}${cause.parameter ? ` of ${cause.parameter}` : ""}`;
  if (cause.collection) return COLLECTION_BY_ID.get(cause.collection)?.label ?? cause.collection;
  return "The expression";
}

export default async function FindingPage({ params }: { params: Promise<{ evaluationId: string; findingId: string }> }) {
  const { evaluationId, findingId } = await params;
  const db = getDb();
  const evaluation = findEvaluation(db, evaluationId);
  if (!evaluation) notFound();
  const finding = db
    .select()
    .from(findings)
    .where(and(eq(findings.publicId, findingId), eq(findings.evaluationId, evaluation.id)))
    .get();
  if (!finding) notFound();

  const document = findingDocument(finding);
  const control = document.control as JsonObject;
  const subject = document.subject as JsonObject;
  const release = releaseById(db, finding.standardReleaseId);
  const standard = standardById(db, release.standardId);
  const assessment = assessmentById(db, evaluation.assessmentId);
  const evidence = (document.evidence ?? {}) as JsonObject;
  const causes = (Array.isArray(document.causes) ? document.causes : []) as unknown as Cause[];
  const applicability = document.applicability as unknown as TraceNode;
  const condition = document.condition as unknown as TraceNode | null;
  const guidance = document.guidance as JsonObject | null;
  const profile = subject.profile as JsonObject | null | undefined;
  const map = subject.map as JsonObject | null | undefined;
  const subjectLink =
    subject.type === "repository" ? (
      profile ? (
        <Link href={`/profiles/${String(profile.public_id)}`}>{`${String(subject.name)} Profile`}</Link>
      ) : (
        <span>{`${String(subject.name)} (no Profile)`}</span>
      )
    ) : map ? (
      <Link href={`/assessments/${assessment.publicId}/map`}>Relationship Map</Link>
    ) : (
      <span>Relationship Map (not available)</span>
    );

  return (
    <Page>
      <PageHeader
        title={String(control.title)}
        back={{ href: `/evaluations/${evaluation.publicId}#findings`, label: `Evaluation ${evaluation.publicId}` }}
        badge={<StatusBadge state={finding.outcome} />}
        description={`${String(subject.name)}, evaluated against ${standard.name} v${release.version}.`}
      />

      <Card title="Result">
        <p>{String(document.reasoning)}</p>
        <DetailsList
          items={[
            ["Outcome", <StatusBadge key="outcome" state={finding.outcome} />],
            ["Severity", finding.severity],
            ["Subject", subjectLink],
            ...(typeof subject.commit === "string" ? ([["Commit", <ShortSha key="commit" sha={subject.commit} />]] as [string, React.ReactNode][]) : []),
            ["Release", <Link key="release" href={`/standards/${standard.publicId}/releases/${release.publicId}`}>{`${standard.name} v${release.version}`}</Link>],
            ["Control key", <Mono key="key">{finding.controlKey}</Mono>],
            ["Evaluator version", <Mono key="evaluator">{String(document.evaluator_version)}</Mono>],
          ]}
        />
      </Card>

      {finding.outcome === "indeterminate" && (
        <Card title="Why this is Indeterminate" description="Every cause that prevented a decision. Resolving any one of them may not be enough.">
          {causes.length ? (
            <ul className={styles.causes} aria-label="Indeterminate causes">
              {causes.map((cause, index) => (
                <li key={index}>
                  <strong>{causeSubject(cause)}</strong>
                  {cause.selector && <> <code className={ui.mono}>{cause.selector}</code></>}: {cause.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p>The evidence could not establish a result.</p>
          )}
        </Card>
      )}

      <Card title="Expected state" description={String(control.rationale)}>
        <DetailsList
          items={[
            ["Applies when", <ExpressionView key="applicability" expression={control.applicability ?? null} />],
            ["Expected", <ExpressionView key="condition" expression={control.condition ?? null} />],
          ]}
        />
      </Card>

      <Card title="What was observed" description="How each part of the Control was read against the Profile or Relationship Map, with the values it saw.">
        <h3 className={styles.traceHeading}>Applicability</h3>
        <TraceView trace={applicability} records={evidence} assessmentId={assessment.publicId} label="Applicability trace" />
        <h3 className={styles.traceHeading}>Expected condition</h3>
        {condition ? (
          <TraceView trace={condition} records={evidence} assessmentId={assessment.publicId} label="Condition trace" />
        ) : (
          <p className={ui.muted}>{finding.outcome === "not_applicable" ? "Not evaluated, because the Control does not apply." : "Not evaluated, because whether the Control applies is unknown."}</p>
        )}
      </Card>

      <Card title="Evidence" description="Every committed location the observed values came from.">
        <EvidenceList ids={Object.keys(evidence)} records={evidence} assessmentId={assessment.publicId} />
      </Card>

      {guidance && (
        <Card title="Diagnostic guidance" description="Context from the Standard's author for interpreting this Control.">
          <p>{String(guidance.text)}</p>
          <Notice tone="info">This guidance is diagnostic. Fabricate does not act on it, and it does not verify that following it would change this Finding.</Notice>
        </Card>
      )}
    </Page>
  );
}
