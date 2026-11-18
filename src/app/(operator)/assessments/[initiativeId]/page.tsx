import crypto from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { Alert } from "@/components/ui/alert";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { countLabel } from "@/components/ui/count";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag, TagList } from "@/components/ui/tag";
import { assessmentNumbers, listAssessments, targetsOf } from "@/lib/assessments/assessment-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { evaluationNumbers, evaluationReleasesOf, listEvaluations } from "@/lib/evaluations/evaluation-records";
import { findInitiative, scopeLabel, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { releaseById, releaseLabel, standardById } from "@/lib/standards/standard-records";
import { startEvaluationAction } from "../../evaluations/actions";
import { startAssessment } from "../actions";
import { LaunchForm } from "../launch-form";
import { initiativeOutcome } from "../outcomes";

// One lookup per request, shared by the page and its metadata.
const loadInitiative = cache((publicId: string) => findInitiative(getDb(), publicId));

export async function generateMetadata({ params }: { params: Promise<{ initiativeId: string }> }): Promise<Metadata> {
  const initiative = loadInitiative((await params).initiativeId);
  return { title: initiative?.name ?? "Assessment not found" };
}

const reusable = (state: string) => state === "complete" || state === "complete_with_issues";

export default async function InitiativePage({ params, searchParams }: { params: Promise<{ initiativeId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ initiativeId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const initiative = loadInitiative(initiativeId);
  if (!initiative) notFound();
  // Repository profiling Runs are each a Repository's profile versions, shown under Repositories (docs/profiling.md).
  if (initiative.profiling) redirect("/repositories");

  const sources = selectedSources(db, initiative.id);
  const releases = selectedReleases(db, initiative.id);
  const assessmentNumber = assessmentNumbers(db, initiative.id);
  const evaluationNumber = evaluationNumbers(db, initiative.id);
  const assessments = listAssessments(db, initiative.id).map((assessment) => ({
    assessment,
    number: assessmentNumber.get(assessment.id)!,
    targets: targetsOf(db, assessment.id),
  }));
  const evaluations = listEvaluations(db, { initiativeId: initiative.id }).map((evaluation) => ({
    evaluation,
    number: evaluationNumber.get(evaluation.id)!,
    assessment: assessments.find(({ assessment }) => assessment.id === evaluation.assessmentId)!,
    releases: evaluationReleasesOf(db, evaluation.id).map((pinned) => {
      const release = releaseById(db, pinned.standardReleaseId);
      return releaseLabel(standardById(db, release.standardId), release);
    }),
  }));
  const enabledCount = listSources(db, { enabled: true }).length;
  const scope = initiative.selectionMode === "all_enabled" ? `${scopeLabel(initiative, 0)} (${enabledCount} now)` : scopeLabel(initiative, sources.length);
  // Salt Patterns assesses template versions, which DE FabLab adds; only its Releases are chosen here.
  const templates = initiative.systemOwned;
  const editHref = `/assessments/${initiative.publicId}/edit`;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ href: "/assessments", label: "Assessments" }]}
        title={initiative.name}
        meta={[
          <span key="created">
            Created <RelativeTime value={initiative.createdAt} />
          </span>,
        ]}
        description={initiative.objective || undefined}
        secondaryActions={[templates ? { href: editHref, label: "Select Releases", icon: "edit" } : { href: editHref, label: "Edit", icon: "edit" }]}
        primaryAction={
          templates ? undefined : (
            <LaunchForm
              action={startAssessment.bind(null, initiative.publicId)}
              launchToken={crypto.randomUUID()}
              label="Start Run"
              failure="The Run was not started because its scope could not be resolved."
            />
          )
        }
        alerts={
          <>
            <OutcomeToast outcome={initiativeOutcome(param(query, "notice"), initiative)} />
            {templates && (
              <Alert tone="info" title="Owned by DE FabLab">
                Runs start when a template version is accepted or re-checked, and each is evaluated against the Releases selected here. Its name, objective, and targets can&apos;t change.
              </Alert>
            )}
          </>
        }
      />

      <Section title="Overview">
        <DescriptionList surface
          layout="columns"
          items={[
            templates ? ["Targets", "Template versions, added when one is accepted or re-checked"] : ["Repositories", scope],
            ...(initiative.selectionMode === "explicit" && !templates
              ? ([
                  [
                    "Selected Repositories",
                    <span key="sources">
                      {sources.map((source, index) => (
                        <span key={source.publicId}>
                          {index > 0 && ", "}
                          {source.name}
                          {!source.enabled && " (disabled)"}
                        </span>
                      ))}
                    </span>,
                  ],
                ] as const)
              : []),
            [
              "Standard Releases",
              releases.length ? (
                <span key="releases">
                  {releases.map(({ release, standard }, index) => (
                    <span key={release.publicId}>
                      {index > 0 && ", "}
                      <Link href={`/standards/${standard.publicId}/releases/${release.publicId}`}>{releaseLabel(standard, release)}</Link>
                    </span>
                  ))}
                </span>
              ) : (
                <span key="releases">
                  None selected. <Link href={`${editHref}#initiative-releases`}>Select a Release</Link> {templates ? "to hold templates to it." : "to run Evaluations."}
                </span>
              ),
            ],
          ]}
        />
      </Section>

      <Section title="Runs" description="Each Run keeps the scope it started with; a finished one can be evaluated again after the Release selection changes.">
        <Panel flush>
          {assessments.length > 0 ? (
            <Table
              label="Run history"
              head={
                <>
                  <Th>Run</Th>
                  <Th>Status</Th>
                  <Th>Scope</Th>
                  <Th>Finished</Th>
                  <Th align="actions" hidden>
                    Evaluate
                  </Th>
                </>
              }
            >
              {assessments.map(({ assessment, number, targets }) => {
                const failed = targets.filter((target) => target.state === "failed").length;
                const canceled = targets.filter((target) => target.state === "canceled").length;
                return (
                  <tr key={assessment.publicId}>
                    <Td label="Run">
                      <Primary>
                        <Link href={`/runs/${assessment.publicId}`}>{`Run #${number}`}</Link>
                      </Primary>
                      <Secondary>
                        Started <RelativeTime value={assessment.createdAt} />
                      </Secondary>
                    </Td>
                    <Td label="Status">
                      <Status state={assessment.state} />
                    </Td>
                    <Td label="Scope">{[templates ? targets.map((target) => target.sourceName).join(", ") : countLabel(targets.length, "Repository", "Repositories"), failed ? `${failed} failed` : null, canceled ? `${canceled} canceled` : null].filter(Boolean).join(" · ")}</Td>
                    <Td label="Finished">
                      <RelativeTime value={assessment.finishedAt} />
                    </Td>
                    <Td align="actions">
                      <RowActions>
                        {!reusable(assessment.state) ? (
                          <Secondary>{assessment.state === "failed" || assessment.state === "canceled" ? "No results to evaluate" : "Evaluate once finished"}</Secondary>
                        ) : releases.length === 0 ? (
                          <Link href={`/assessments/${initiative.publicId}/edit#initiative-releases`}>Select a Release to evaluate</Link>
                        ) : (
                          <LaunchForm
                            action={startEvaluationAction.bind(null, initiative.publicId, assessment.publicId)}
                            launchToken={crypto.randomUUID()}
                            label="Start Evaluation"
                            accessibleName={`Start Evaluation of Run #${number}`}
                            failure={`The Evaluation of Run #${number} was not started.`}
                            variant="secondary"
                            size="sm"
                          />
                        )}
                      </RowActions>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <EmptyState title="No Runs yet">{templates ? "A Run starts when a template version is accepted or re-checked." : "Start a Run to pin each scoped repository to a commit and profile it without running its code."}</EmptyState>
          )}
        </Panel>
      </Section>

      <Section title="Evaluations" description="Comparisons of a Run with the Standard Releases selected when each started.">
        <Panel flush>
          {evaluations.length > 0 ? (
            <Table
              label="Evaluation history"
              head={
                <>
                  <Th>Evaluation</Th>
                  <Th>Status</Th>
                  <Th>Run</Th>
                  <Th>Standard Releases</Th>
                  <Th>Finished</Th>
                </>
              }
            >
              {evaluations.map(({ evaluation, number, assessment, releases: pinned }) => (
                <tr key={evaluation.publicId}>
                  <Td label="Evaluation">
                    <Primary>
                      <Link href={`/evaluations/${evaluation.publicId}`}>{`Evaluation #${number}`}</Link>
                    </Primary>
                    <Secondary>
                      Started <RelativeTime value={evaluation.createdAt} />
                    </Secondary>
                  </Td>
                  <Td label="Status">
                    <Status state={evaluation.state} />
                  </Td>
                  <Td label="Run">
                    <Link href={`/runs/${assessment.assessment.publicId}`}>{`Run #${assessment.number}`}</Link>
                  </Td>
                  <Td label="Standard Releases">
                    <TagList values={pinned} />
                  </Td>
                  <Td label="Finished">
                    <RelativeTime value={evaluation.finishedAt} />
                  </Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No Evaluations yet">
              {releases.length ? "Start an Evaluation from a finished Run above." : "Select a published Standard Release, then evaluate a finished Run."}
            </EmptyState>
          )}
        </Panel>
      </Section>

      <Disclosure summary="Details" variant="plain">
        <DescriptionList surface
          items={[
            [
              "ID",
              <Tag key="id" copy label="ID">
                {initiative.publicId}
              </Tag>,
            ],
            ["Created", <RelativeTime key="created" value={initiative.createdAt} />],
            ["Updated", <RelativeTime key="updated" value={initiative.updatedAt} />],
          ]}
        />
      </Disclosure>
    </Page>
  );
}
