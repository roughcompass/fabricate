import { type JsonObject, SHARED_CATEGORIES } from "@repo-facts/contract";
import { DetailsTemplate } from "@/components/templates/details-template";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ExpressionView } from "@/app/(operator)/standards/control-view";
import { EvidenceList } from "@/components/results/evidence";
import { TraceView } from "@/components/results/trace";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Section } from "@/components/ui/section";
import { Severity, Status } from "@/components/ui/status";
import { ShortValue, Tag } from "@/components/ui/tag";
import { runById } from "@/lib/runs/lookups";
import { runNumber } from "@/lib/runs/run-records";
import { getDb } from "@/lib/db/client";
import { PRODUCT } from "@/lib/product";
import { evaluationNumber, findEvaluation, findFinding, findingDocument } from "@/lib/evaluations/evaluation-records";
import type { TraceNode } from "@/lib/evaluations/interpreter";
import { assessmentById } from "@/lib/assessments/assessment-records";
import { findingCategory } from "@/lib/profiles/links";
import { profileSectionHref } from "@/lib/profiles/tabs";
import { releaseById, standardById } from "@/lib/standards/standard-records";
import { findRepository } from "@/lib/repositories/repository-records";
import { COLLECTION_BY_ID, SELECTOR_BY_ID } from "@/lib/standards/registry";
import styles from "./finding.module.css";
import { routes } from "@/lib/web/routes";

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
  const finding = findFinding(db, evaluation, findingId);
  if (!finding) return undefined;
  return { evaluation, finding, document: findingDocument(finding), assessment: assessmentById(db, evaluation.assessmentId), number: evaluationNumber(db, evaluation) };
});

export async function generateMetadata({ params }: PageProps<"/evaluations/[evaluationId]/findings/[findingId]">): Promise<Metadata> {
  const { evaluationId, findingId } = await params;
  const found = load(evaluationId, findingId);
  if (!found) return { title: "Finding not found" };
  return { title: `${String((found.document.control as JsonObject).title)} · ${String((found.document.subject as JsonObject).name)}` };
}

export default async function FindingPage({ params }: PageProps<"/evaluations/[evaluationId]/findings/[findingId]">) {
  const { evaluationId, findingId } = await params;
  const db = getDb();
  const found = load(evaluationId, findingId);
  if (!found) notFound();
  const { evaluation, finding, document, assessment, number } = found;
  const control = document.control as JsonObject;
  const subject = document.subject as JsonObject;
  const release = releaseById(db, finding.standardReleaseId);
  const standard = standardById(db, release.standardId);
  const run = runById(db, evaluation.runId);
  const evidence = (document.evidence ?? {}) as JsonObject;
  const causes = (Array.isArray(document.causes) ? document.causes : []) as unknown as Cause[];
  const applicability = document.applicability as unknown as TraceNode;
  const condition = document.condition as unknown as TraceNode | null;
  const guidance = document.guidance as JsonObject | null;
  const profile = subject.profile as JsonObject | null | undefined;
  const map = subject.map as JsonObject | null | undefined;
  const releaseLink = <Link href={routes.release(standard.publicId, release.publicId)}>{`${standard.name} v${release.version}`}</Link>;
  // The Profile link opens the category the Control reads, and names it.
  const category = findingCategory(condition, applicability);
  const categoryLabel = category ? SHARED_CATEGORIES.find((definition) => definition.id === category)?.label : undefined;
  // A repository subject links to its Repository page, unless it has since been deleted.
  const repositoryLink =
    subject.type === "repository" && typeof subject.key === "string" && findRepository(db, subject.key) ? (
      <Link key="repository" href={routes.repository(subject.key)}>
        {String(subject.name)}
      </Link>
    ) : (
      String(subject.name)
    );
  const profileLink =
    subject.type === "repository" ? (
      profile ? (
        <Link href={category && categoryLabel ? profileSectionHref(routes.profile(String(profile.public_id)), category) : routes.profile(String(profile.public_id))}>{category && categoryLabel ? `${categoryLabel} in the ${String(subject.name)} Profile` : `${String(subject.name)} Profile`}</Link>
      ) : (
        <span>{`None; ${String(subject.name)} had no Profile in this Run`}</span>
      )
    ) : map ? (
      <Link href={routes.runMap(run.publicId)}>Relationship Map</Link>
    ) : (
      <span>Relationship Map (not available)</span>
    );

  return (
    <DetailsTemplate
      header={{
        breadcrumbs: [
          { href: "/assessments", label: "Assessments" },
          { href: routes.assessment(assessment.publicId), label: assessment.name },
          { href: routes.run(run.publicId), label: `Run #${runNumber(db, run)}` },
          { href: routes.evaluation(evaluation.publicId), label: `Evaluation #${number}` },
        ],
        title: String(control.title),
        status: <Status state={finding.outcome} />,
        meta: [repositoryLink, releaseLink, <Severity key="severity" value={finding.severity} />],
      }}
    >

      <Section title="Result">
        <p className={styles.reasoning}>{String(document.reasoning)}</p>
        <DescriptionList surface
          items={[
            ...(subject.type === "repository" ? ([["Repository", repositoryLink], ["Profile", profileLink]] as [string, React.ReactNode][]) : ([["Subject", profileLink]] as [string, React.ReactNode][])),
            ...(typeof subject.commit === "string" ? ([["Commit", <ShortValue key="commit" value={subject.commit} label="commit" />]] as [string, React.ReactNode][]) : []),
          ]}
        />
      </Section>

      {finding.outcome === "indeterminate" && (
        <Section title="Why this is Indeterminate" description="Every cause that prevented a decision; resolving one of them may not be enough.">
          {causes.length ? (
            <ul className={styles.causes} aria-label="Indeterminate causes">
              {causes.map((cause, index) => (
                <li key={index}>
                  <strong>{causeSubject(cause)}</strong>: {cause.reason}
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
            ["Applies when", <ExpressionView key="applicability" expression={control.applicability ?? null} paths={false} />],
            ["Expected", <ExpressionView key="condition" expression={control.condition ?? null} paths={false} />],
          ]}
        />
        {/* The second layer: the fields' paths and the Control's key, for whoever writes or debugs Controls. */}
        <Disclosure summary="Field paths and Control key" variant="plain">
          <DescriptionList
            items={[
              ["Applies when", <ExpressionView key="applicability" expression={control.applicability ?? null} />],
              ["Expected", <ExpressionView key="condition" expression={control.condition ?? null} />],
              ["Control key", <Tag key="key">{finding.controlKey}</Tag>],
            ]}
          />
        </Disclosure>
      </Section>

      <Section title="What was observed" description="How each part of the Control was read against the Profile or Relationship Map, with the values it saw.">
        <div className={styles.traces}>
          <div>
            <h3>Applicability</h3>
            <TraceView trace={applicability} records={evidence} owner={{ run: run.publicId }} label="Applicability trace" />
          </div>
          <div>
            <h3>Expected condition</h3>
            {condition ? (
              <TraceView trace={condition} records={evidence} owner={{ run: run.publicId }} label="Condition trace" />
            ) : (
              <p className={styles.muted}>{finding.outcome === "not_applicable" ? "Not evaluated, because the Control does not apply." : "Not evaluated, because whether the Control applies is unknown."}</p>
            )}
          </div>
        </div>
      </Section>

      <Section title="Evidence" description="Every committed location the observed values came from.">
        <EvidenceList ids={Object.keys(evidence)} records={evidence} owner={{ run: run.publicId }} />
      </Section>

      {guidance && (
        <Section title="Diagnostic guidance" description={`This guidance is diagnostic: the ${PRODUCT.name} does not act on it, or check that following it would change this Finding.`}>
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
    </DetailsTemplate>
  );
}
