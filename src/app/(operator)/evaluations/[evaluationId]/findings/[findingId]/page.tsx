import { type JsonObject, SHARED_CATEGORIES } from "@repo-facts/contract";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { ExpressionView } from "@/app/(operator)/standards/control-view";
import { EvidenceList } from "@/components/results/evidence";
import { TraceView } from "@/components/results/trace";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Page, PageHeader } from "@/components/ui/page";
import { Section } from "@/components/ui/section";
import { Severity, Status } from "@/components/ui/status";
import { ShortValue, Tag } from "@/components/ui/tag";
import { assessmentById } from "@/lib/assessments/lookups";
import { getDb } from "@/lib/db/client";
import { findings } from "@/lib/db/schema";
import { evaluationNumber, findEvaluation, findingDocument } from "@/lib/evaluations/evaluation-records";
import type { TraceNode } from "@/lib/evaluations/interpreter";
import { initiativeById } from "@/lib/initiatives/initiative-records";
import { findingCategory } from "@/lib/profiles/links";
import { profileSectionHref } from "@/lib/profiles/tabs";
import { releaseById, standardById } from "@/lib/standards/standard-records";
import { COLLECTION_BY_ID, SELECTOR_BY_ID } from "@/lib/standards/registry";
import styles from "./finding.module.css";

type Cause = { selector: string | null; parameter: string | null; collection: string | null; reason: string };

function causeSubject(cause: Cause): string {
  if (cause.selector) return `${SELECTOR_BY_ID.get(cause.selector)?.label ?? cause.selector}${cause.parameter ? ` of ${cause.parameter}` : ""}`;
  if (cause.collection) return COLLECTION_BY_ID.get(cause.collection)?.label ?? cause.collection;
  return "The expression";
}

const load = cache((evaluationId: string, findingId: string) => {
  const db = getDb();
  const evaluation = findEvaluation(db, evaluationId);
  if (!evaluation) return undefined;
  const finding = db
    .select()
    .from(findings)
    .where(and(eq(findings.publicId, findingId), eq(findings.evaluationId, evaluation.id)))
    .get();
  if (!finding) return undefined;
  return { evaluation, finding, document: findingDocument(finding), initiative: initiativeById(db, evaluation.initiativeId), number: evaluationNumber(db, evaluation) };
});

export async function generateMetadata({ params }: { params: Promise<{ evaluationId: string; findingId: string }> }): Promise<Metadata> {
  const { evaluationId, findingId } = await params;
  const found = load(evaluationId, findingId);
  if (!found) return { title: "Finding not found" };
  return { title: `${String((found.document.control as JsonObject).title)} · ${String((found.document.subject as JsonObject).name)}` };
}

export default async function FindingPage({ params }: { params: Promise<{ evaluationId: string; findingId: string }> }) {
  const { evaluationId, findingId } = await params;
  const db = getDb();
  const found = load(evaluationId, findingId);
  if (!found) notFound();
  const { evaluation, finding, document, initiative, number } = found;
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
  const releaseLink = <Link href={`/standards/${standard.publicId}/releases/${release.publicId}`}>{`${standard.name} v${release.version}`}</Link>;
  // The Profile link opens the category the Control reads, and names it.
  const category = findingCategory(condition, applicability);
  const categoryLabel = category ? SHARED_CATEGORIES.find((definition) => definition.id === category)?.label : undefined;
  const subjectLink =
    subject.type === "repository" ? (
      profile ? (
        <Link href={category && categoryLabel ? profileSectionHref(`/profiles/${String(profile.public_id)}`, category) : `/profiles/${String(profile.public_id)}`}>{category && categoryLabel ? `${categoryLabel} in the ${String(subject.name)} Profile` : `${String(subject.name)} Profile`}</Link>
      ) : (
        <span>{`${String(subject.name)} (no Profile)`}</span>
      )
    ) : map ? (
      <Link href={`/runs/${assessment.publicId}/map`}>Relationship Map</Link>
    ) : (
      <span>Relationship Map (not available)</span>
    );

  return (
    <Page>
      <PageHeader
        breadcrumbs={[
          { href: "/assessments", label: "Assessments" },
          { href: `/assessments/${initiative.publicId}`, label: initiative.name },
          { href: `/evaluations/${evaluation.publicId}`, label: `Evaluation #${number}` },
        ]}
        title={String(control.title)}
        status={<Status state={finding.outcome} />}
        meta={[String(subject.name), releaseLink, <Severity key="severity" value={finding.severity} />]}
      />

      <Section title="Result">
        <p className={styles.reasoning}>{String(document.reasoning)}</p>
        <DescriptionList surface
          items={[
            ["Subject", subjectLink],
            ...(typeof subject.commit === "string" ? ([["Commit", <ShortValue key="commit" value={subject.commit} label="commit" />]] as [string, React.ReactNode][]) : []),
            ["Control key", <Tag key="key">{finding.controlKey}</Tag>],
          ]}
        />
      </Section>

      {finding.outcome === "indeterminate" && (
        <Section title="Why this is Indeterminate" description="Every cause that prevented a decision; resolving one of them may not be enough.">
          {causes.length ? (
            <ul className={styles.causes} aria-label="Indeterminate causes">
              {causes.map((cause, index) => (
                <li key={index}>
                  <strong>{causeSubject(cause)}</strong>
                  {cause.selector && (
                    <>
                      {" "}
                      <code className={styles.id}>{cause.selector}</code>
                    </>
                  )}
                  : {cause.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p>The evidence could not establish a result.</p>
          )}
        </Section>
      )}

      <Section title="Expected state" description={String(control.rationale)}>
        <DescriptionList surface
          items={[
            ["Applies when", <ExpressionView key="applicability" expression={control.applicability ?? null} />],
            ["Expected", <ExpressionView key="condition" expression={control.condition ?? null} />],
          ]}
        />
      </Section>

      <Section title="What was observed" description="How each part of the Control was read against the Profile or Relationship Map, with the values it saw.">
        <div className={styles.traces}>
          <div>
            <h3>Applicability</h3>
            <TraceView trace={applicability} records={evidence} assessmentId={assessment.publicId} label="Applicability trace" />
          </div>
          <div>
            <h3>Expected condition</h3>
            {condition ? (
              <TraceView trace={condition} records={evidence} assessmentId={assessment.publicId} label="Condition trace" />
            ) : (
              <p className={styles.muted}>{finding.outcome === "not_applicable" ? "Not evaluated, because the Control does not apply." : "Not evaluated, because whether the Control applies is unknown."}</p>
            )}
          </div>
        </div>
      </Section>

      <Section title="Evidence" description="Every committed location the observed values came from.">
        <EvidenceList ids={Object.keys(evidence)} records={evidence} assessmentId={assessment.publicId} />
      </Section>

      {guidance && (
        <Section title="Diagnostic guidance" description="This guidance is diagnostic: DE FabLab does not act on it, or check that following it would change this Finding.">
          <p>{String(guidance.text)}</p>
        </Section>
      )}

      <Disclosure summary="Details" variant="plain">
        <DescriptionList surface
          items={[
            ["Evaluator version", String(document.evaluator_version)],
            ["ID", <Tag key="id" copy label="ID">{finding.publicId}</Tag>],
          ]}
        />
      </Disclosure>
    </Page>
  );
}
