import crypto from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Timestamp, countLabel } from "@/components/ui/format";
import { Card, DetailsList, EmptyState, Page, PageHeader, ui } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono, Secondary, Table, Td, Th } from "@/components/ui/table";
import { listAssessments, targetsOf } from "@/lib/assessments/assessment-records";
import { evaluationReleasesOf, listEvaluations } from "@/lib/evaluations/evaluation-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { findInitiative, scopeLabel, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { releaseById, releaseLabel, standardById } from "@/lib/standards/standard-records";
import { startEvaluationAction } from "../../evaluations/actions";
import { startAssessment } from "../actions";
import { LaunchForm } from "../launch-form";
import styles from "../initiatives.module.css";

export const metadata: Metadata = { title: "Initiative" };

const NOTICES: Record<string, [tone: "success" | "warning", message: string]> = {
  created: ["success", "The initiative was created."],
  updated: ["success", "The initiative was updated. Existing Assessments and Evaluations keep the scope and Releases they started with."],
  retained: ["warning", "This initiative has Assessments, so it is retained to keep their history reviewable."],
};

export default async function InitiativePage({ params, searchParams }: { params: Promise<{ initiativeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ initiativeId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const initiative = findInitiative(db, initiativeId);
  if (!initiative) notFound();

  const sources = selectedSources(db, initiative.id);
  const releases = selectedReleases(db, initiative.id);
  const assessments = listAssessments(db, initiative.id).map((assessment) => ({ assessment, targets: targetsOf(db, assessment.id) }));
  const evaluations = listEvaluations(db, { initiativeId: initiative.id }).map((evaluation) => ({
    evaluation,
    assessment: assessments.find(({ assessment }) => assessment.id === evaluation.assessmentId)!.assessment,
    releases: evaluationReleasesOf(db, evaluation.id).map((pinned) => {
      const release = releaseById(db, pinned.standardReleaseId);
      return releaseLabel(standardById(db, release.standardId), release);
    }),
  }));
  const reusable = (state: string) => state === "complete" || state === "complete_with_issues";
  const enabledCount = listSources(db, { enabled: true }).length;
  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <Page>
      <PageHeader
        title={initiative.name}
        back={{ href: "/", label: "Initiatives" }}
        description={initiative.objective || undefined}
        actions={
          <>
            <ButtonLink href={`/initiatives/${initiative.publicId}/edit`} icon="edit">
              Edit
            </ButtonLink>
            <LaunchForm action={startAssessment.bind(null, initiative.publicId)} launchToken={crypto.randomUUID()} />
          </>
        }
      />

      {notice && (
        <Notice tone={notice[0]} live>
          {notice[1]}
        </Notice>
      )}

      <Card title="Scope">
        <DetailsList
          items={[
            ["Repositories", initiative.selectionMode === "all_enabled" ? `All enabled sources (${enabledCount} now)` : scopeLabel(initiative, sources.length)],
            ...(initiative.selectionMode === "explicit"
              ? ([
                  [
                    "Selected",
                    <ul key="selected" className={styles.releases}>
                      {sources.map((source) => (
                        <li key={source.publicId} className={styles.release}>
                          <span>{source.name}</span>
                          {!source.enabled && <StatusBadge state="disabled" />}
                        </li>
                      ))}
                    </ul>,
                  ],
                ] as const)
              : []),
            ["Public id", <Mono key="id">{initiative.publicId}</Mono>],
          ]}
        />
      </Card>

      <Card
        title="Standard Releases"
        description={
          releases.length
            ? "Each selected Release is evaluated independently. Assessments never depend on these selections."
            : "None selected. Assessments establish current state without a Standard; select a published Release to run Evaluations."
        }
      >
        {releases.length > 0 && (
          <ul className={styles.releases}>
            {releases.map(({ release, standard }) => (
              <li key={release.publicId} className={styles.release}>
                <Link href={`/standards/${standard.publicId}/releases/${release.publicId}`}>{releaseLabel(standard, release)}</Link>
                <Mono>{release.digest.slice(0, 12)}</Mono>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Assessments"
        description="Current-state runs, newest first. Each keeps the scope it started with, and a finished one can be evaluated again whenever the Release selection changes."
        flush={assessments.length > 0}
      >
        {assessments.length > 0 ? (
          <Table
            label="Assessment history"
            head={
              <>
                <Th>Assessment</Th>
                <Th>Status</Th>
                <Th>Scope</Th>
                <Th>Started</Th>
                <Th>Finished</Th>
                <Th align="actions">Evaluate</Th>
              </>
            }
          >
            {assessments.map(({ assessment, targets }) => {
              const failed = targets.filter((target) => target.state === "failed").length;
              const canceled = targets.filter((target) => target.state === "canceled").length;
              return (
                <tr key={assessment.publicId}>
                  <Td label="Assessment">
                    <Link href={`/assessments/${assessment.publicId}`}>
                      <Mono>{assessment.publicId}</Mono>
                    </Link>
                    <Secondary>
                      <Timestamp value={assessment.createdAt} />
                    </Secondary>
                  </Td>
                  <Td label="Status">
                    <StatusBadge state={assessment.state} />
                  </Td>
                  <Td label="Scope">
                    {[countLabel(targets.length, "source"), failed ? `${failed} failed` : null, canceled ? `${canceled} canceled` : null].filter(Boolean).join(" · ")}
                  </Td>
                  <Td label="Started">
                    <Timestamp value={assessment.startedAt} />
                  </Td>
                  <Td label="Finished">
                    <Timestamp value={assessment.finishedAt} />
                  </Td>
                  <Td label="Evaluate" align="actions">
                    {!reusable(assessment.state) ? (
                      <span className={ui.muted}>{assessment.state === "failed" || assessment.state === "canceled" ? "No results to evaluate" : "After it finishes"}</span>
                    ) : releases.length === 0 ? (
                      <Link href={`/initiatives/${initiative.publicId}/edit`}>Select a Release to evaluate</Link>
                    ) : (
                      <LaunchForm
                        action={startEvaluationAction.bind(null, initiative.publicId, assessment.publicId)}
                        launchToken={crypto.randomUUID()}
                        label="Start Evaluation"
                        failure="The Evaluation was not started."
                        variant="secondary"
                      />
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState title="Not assessed yet">Start an assessment to pin every scoped repository to a commit and analyze it without running its code.</EmptyState>
        )}
      </Card>

      <Card title="Evaluations" description="Diagnostic comparisons of an Assessment with the Releases selected when each started, newest first." flush={evaluations.length > 0}>
        {evaluations.length > 0 ? (
          <Table
            label="Evaluation history"
            head={
              <>
                <Th>Evaluation</Th>
                <Th>Status</Th>
                <Th>Assessment</Th>
                <Th>Releases</Th>
                <Th>Finished</Th>
              </>
            }
          >
            {evaluations.map(({ evaluation, assessment, releases: pinned }) => (
              <tr key={evaluation.publicId}>
                <Td label="Evaluation">
                  <Link href={`/evaluations/${evaluation.publicId}`}>
                    <Mono>{evaluation.publicId}</Mono>
                  </Link>
                  <Secondary>
                    <Timestamp value={evaluation.createdAt} />
                  </Secondary>
                </Td>
                <Td label="Status">
                  <StatusBadge state={evaluation.state} />
                </Td>
                <Td label="Assessment">
                  <Link href={`/assessments/${assessment.publicId}`}>
                    <Mono>{assessment.publicId}</Mono>
                  </Link>
                </Td>
                <Td label="Releases">
                  <ul className={ui.plainList}>
                    {pinned.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </Td>
                <Td label="Finished">
                  <Timestamp value={evaluation.finishedAt} />
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="Not evaluated yet">{releases.length ? "Start an Evaluation from a finished Assessment above." : "Select a published Standard Release, then evaluate a finished Assessment."}</EmptyState>
        )}
      </Card>
    </Page>
  );
}
