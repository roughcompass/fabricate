import crypto from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { countLabel } from "@/components/ui/count";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag, TagList } from "@/components/ui/tag";
import { type Run, runNumbers, type RunTarget, listRuns, targetsOf } from "@/lib/runs/run-records";
import { listSources } from "@/lib/catalog/source-records";
import { getDb } from "@/lib/db/client";
import { type Evaluation, evaluationNumbers, evaluationReleasesOf, listEvaluations } from "@/lib/evaluations/evaluation-records";
import { type Initiative, scopeLabel, selectedReleases, selectedSources } from "@/lib/initiatives/initiative-records";
import { releaseById, releaseLabel, standardById } from "@/lib/standards/standard-records";
import { startEvaluationAction } from "../../evaluations/actions";
import { startRun } from "../actions";
import { LaunchForm } from "../launch-form";
import { initiativeOutcome } from "../outcomes";
import { routes } from "@/lib/web/routes";
import { loadAssessment } from "./load";

// One lookup per request, shared by the page and its metadata.
export async function generateMetadata({ params }: PageProps<"/assessments/[initiativeId]">): Promise<Metadata> {
  const initiative = loadAssessment((await params).initiativeId);
  return { title: initiative?.name ?? "Assessment not found" };
}

const reusable = (state: string) => state === "complete" || state === "complete_with_issues";

interface RunRow {
  run: Run;
  number: number;
  targets: RunTarget[];
}

interface EvaluationRow {
  evaluation: Evaluation;
  number: number;
  run: RunRow;
  releases: string[];
}

export default async function InitiativePage({ params, searchParams }: PageProps<"/assessments/[initiativeId]">) {
  const [{ initiativeId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const initiative = loadAssessment(initiativeId);
  if (!initiative) notFound();

  const sources = selectedSources(db, initiative.id);
  const releases = selectedReleases(db, initiative.id);
  const runNumber = runNumbers(db, initiative.id);
  const evaluationNumber = evaluationNumbers(db, initiative.id);
  const runs = listRuns(db, initiative.id).map((run) => ({
    run,
    number: runNumber.get(run.id)!,
    targets: targetsOf(db, run.id),
  }));
  const evaluations = listEvaluations(db, { initiativeId: initiative.id }).map((evaluation) => ({
    evaluation,
    number: evaluationNumber.get(evaluation.id)!,
    run: runs.find(({ run }) => run.id === evaluation.runId)!,
    releases: evaluationReleasesOf(db, evaluation.id).map((pinned) => {
      const release = releaseById(db, pinned.standardReleaseId);
      return releaseLabel(standardById(db, release.standardId), release);
    }),
  }));
  const scope = initiative.selectionMode === "all" ? `${scopeLabel(initiative, 0)} (${listSources(db).length} now)` : scopeLabel(initiative, sources.length);
  const editHref = routes.assessmentEdit(initiative.publicId);

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
        secondaryActions={[{ href: editHref, label: "Edit", icon: "edit" }]}
        primaryAction={<LaunchForm action={startRun.bind(null, initiative.publicId)} launchToken={crypto.randomUUID()} label="Start Run" failure="The Run was not started because its scope could not be resolved." />}
        alerts={<OutcomeToast outcome={initiativeOutcome(param(query, "notice"), initiative)} />}
      />

      <Section title="Overview">
        <DescriptionList surface
          layout="columns"
          items={[
            ["Repositories", scope],
            ...(initiative.selectionMode === "explicit"
              ? ([
                  [
                    "Selected Repositories",
                    <span key="sources">
                      {sources.map((source, index) => (
                        <span key={source.publicId}>
                          {index > 0 && ", "}
                          {source.name}
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
                      <Link href={routes.release(standard.publicId, release.publicId)}>{releaseLabel(standard, release)}</Link>
                    </span>
                  ))}
                </span>
              ) : (
                <span key="releases">
                  None selected. <Link href={routes.assessmentEdit(initiative.publicId, "initiative-releases")}>Select a Release</Link> to run Evaluations.
                </span>
              ),
            ],
          ]}
        />
      </Section>

      <RunsSection initiative={initiative} runs={runs} hasReleases={releases.length > 0} />

      <EvaluationsSection evaluations={evaluations} hasReleases={releases.length > 0} />

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

/** Every Run of the Assessment, each with what it can do next: wait, be evaluated, or have a Release selected first. */
function RunsSection({ initiative, runs, hasReleases }: { initiative: Initiative; runs: RunRow[]; hasReleases: boolean }) {
  return (
    <Section title="Runs" description="Each Run keeps the scope it started with; a finished one can be evaluated again after the Release selection changes.">
      <Panel flush>
        {runs.length > 0 ? (
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
            {runs.map(({ run, number, targets }) => {
              const failed = targets.filter((target) => target.state === "failed").length;
              const canceled = targets.filter((target) => target.state === "canceled").length;
              return (
                <tr key={run.publicId}>
                  <Td label="Run">
                    <Primary>
                      <Link href={routes.run(run.publicId)}>{`Run #${number}`}</Link>
                    </Primary>
                    <Secondary>
                      Started <RelativeTime value={run.createdAt} />
                    </Secondary>
                  </Td>
                  <Td label="Status">
                    <Status state={run.state} />
                  </Td>
                  <Td label="Scope">{[countLabel(targets.length, "Repository", "Repositories"), failed ? `${failed} failed` : null, canceled ? `${canceled} canceled` : null].filter(Boolean).join(" · ")}</Td>
                  <Td label="Finished">
                    <RelativeTime value={run.finishedAt} />
                  </Td>
                  <Td align="actions">
                    <RowActions>
                      {!reusable(run.state) ? (
                        <Secondary>{run.state === "failed" || run.state === "canceled" ? "No results to evaluate" : "Evaluate once finished"}</Secondary>
                      ) : !hasReleases ? (
                        <Link href={routes.assessmentEdit(initiative.publicId, "initiative-releases")}>Select a Release to evaluate</Link>
                      ) : (
                        <LaunchForm
                          action={startEvaluationAction.bind(null, initiative.publicId, run.publicId)}
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
          <EmptyState title="No Runs yet">Start a Run to pin each scoped repository to a commit and profile it without running its code.</EmptyState>
        )}
      </Panel>
    </Section>
  );
}

/** Every Evaluation of the Assessment's Runs, newest first. */
function EvaluationsSection({ evaluations, hasReleases }: { evaluations: EvaluationRow[]; hasReleases: boolean }) {
  return (
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
            {evaluations.map(({ evaluation, number, run, releases: pinned }) => (
              <tr key={evaluation.publicId}>
                <Td label="Evaluation">
                  <Primary>
                    <Link href={routes.evaluation(evaluation.publicId)}>{`Evaluation #${number}`}</Link>
                  </Primary>
                  <Secondary>
                    Started <RelativeTime value={evaluation.createdAt} />
                  </Secondary>
                </Td>
                <Td label="Status">
                  <Status state={evaluation.state} />
                </Td>
                <Td label="Run">
                  <Link href={routes.run(run.run.publicId)}>{`Run #${run.number}`}</Link>
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
            {hasReleases ? "Start an Evaluation from a finished Run above." : "Select a published Standard Release, then evaluate a finished Run."}
          </EmptyState>
        )}
      </Panel>
    </Section>
  );
}
