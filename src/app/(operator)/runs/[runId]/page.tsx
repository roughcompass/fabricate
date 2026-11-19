import crypto from "node:crypto";
import type { Metadata } from "next";
import { DetailsTemplate } from "@/components/templates/details-template";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressPoller } from "@/components/progress-poller";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { countLabel } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { pageOf, pageQuery, param, withQuery } from "@/lib/web/query";
import { Pagination } from "@/components/ui/pagination";
import { FailureReason } from "@/components/results/failure-reason";
import { failureKind, failureSentence } from "@/lib/runs/failures";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { StatGroup } from "@/components/ui/stat-group";
import { Status, humanize } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { type RunTarget, targetReferenceLabel, targetsOf } from "@/lib/runs/run-records";
import { targetCommits } from "@/lib/surveys/records";
import { runStatus } from "@/lib/runs/status";
import { getDb } from "@/lib/db/client";
import { RUN_MACHINE, isTerminal, TARGET_MACHINE } from "@/lib/db/state-machines";
import { evaluationNumbers, listEvaluations } from "@/lib/evaluations/evaluation-records";
import { profileDiagnostics, profileDocument, profilesOf, type RepositoryProfile } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { cancelRun } from "../actions";
import { runOutcome } from "../outcomes";
import { routes } from "@/lib/web/routes";
import { loadRun } from "./load";
import { LaunchForm } from "../../assessments/launch-form";
import { startEvaluationAction } from "../../evaluations/actions";
import { evaluableRun } from "@/lib/evaluations/start";
import { selectedReleases } from "@/lib/assessments/assessment-records";
import { liveRepositoryIds } from "@/lib/repositories/repository-records";
import { SURVEYOR_RELEASE_LABEL } from "@/lib/product";

export async function generateMetadata({ params }: PageProps<"/runs/[runId]">): Promise<Metadata> {
  const found = loadRun((await params).runId);
  return { title: found ? `${found.context.name} · ${found.context.owner}` : "Run not found" };
}

export default async function RunPage({ params, searchParams }: PageProps<"/runs/[runId]">) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const found = loadRun(runId);
  if (!found) notFound();
  const { run, assessment, context } = found;
  const { name } = context;

  const targets = targetsOf(db, run.id);
  const profiles = new Map(profilesOf(db, run.id).map(({ profile, target }) => [target.id, profile]));
  const map = mapOf(db, run.id);
  const coverage = map ? (mapDocument(map) as unknown as MapDocument).coverage : null;
  const evaluationNumber = evaluationNumbers(db, assessment.id);
  const evaluations = listEvaluations(db, { runId: run.id });
  const status = runStatus(db, run);
  const terminal = isTerminal(RUN_MACHINE, run.state);
  const failed = targets.filter((target) => target.state === "failed");
  // A failed Run's alert says what happened when every repository failed the same way, rather than repeating its title.
  const failedTogether = failed.length > 0 && new Set(failed.map((target) => failureKind(target.failureCode, target.failureMessage))).size === 1;
  const finished = targets.filter((target) => isTerminal(TARGET_MACHINE, target.state)).length;
  const shownState = !terminal && run.cancelRequestedAt ? "canceling" : run.state;
  const evaluable = evaluableRun(run.state);
  const hasReleases = selectedReleases(db, assessment.id).length > 0;

  return (
    <DetailsTemplate
      header={{
        breadcrumbs: context.parents,
        title: name,
        status: <Status state={shownState} />,
        meta: [
          countLabel(targets.length, "Repository", "Repositories"),
          <span key="started">
            Started <RelativeTime value={run.createdAt} />
          </span>,
          ...(run.finishedAt
            ? [
                <span key="finished">
                  Finished <RelativeTime value={run.finishedAt} />
                </span>,
              ]
            : []),
        ],
        // A finished Run's next step is its Evaluation, against the Releases its Assessment selects now.
        primaryAction:
          evaluable && hasReleases ? (
            <LaunchForm action={startEvaluationAction.bind(null, assessment.publicId, run.publicId)} launchToken={crypto.randomUUID()} label="Start Evaluation" failure={`The Evaluation of ${name} was not started.`} />
          ) : undefined,
        secondaryActions: evaluable && !hasReleases ? [{ href: routes.assessmentEdit(assessment.publicId, "initiative-releases"), label: "Select a Release to evaluate", icon: "checklist" }] : undefined,
      }}
      alerts={
        <>
          <OutcomeToast outcome={runOutcome(param(query, "notice"), run, name)} />
          {!terminal && !run.cancelRequestedAt && <InProgressAlert runId={run.publicId} name={name} />}
          {run.state === "complete_with_issues" && (
            <Alert tone="warning" title={`${failed.length} of ${countLabel(targets.length, "repository", "repositories")} could not be assessed`}>
              {/* The sentence ends with its own punctuation; failures of different kinds are each in the list below. */}
              <p>{`${failed.map((target) => target.repositoryName).join(", ")}: ${failedTogether ? failureSentence(failed[0]!.failureCode, failed[0]!.failureMessage) : "each one's reason is listed below."}`}</p>
              <p>Their relationships are missing from the Relationship Map, and Evaluations treat what they could contain as unknown.</p>
            </Alert>
          )}
          {run.state === "failed" && (
            <Alert tone="error" title="No repository could be assessed">
              {/* The stored reason often repeats the title; the rows below give each repository's reason. */}
              {failedTogether ? failureSentence(failed[0]!.failureCode, failed[0]!.failureMessage) : "Each repository's reason is listed below."}
            </Alert>
          )}
          {run.state === "canceled" && (
            <Alert tone="info" title={`${countLabel(profiles.size, "completed Profile")} ${profiles.size === 1 ? "remains" : "remain"} reviewable.`}>
              Repositories that had not finished when the Run was canceled were not profiled.
            </Alert>
          )}
        </>
      }
    >
      {!status.terminal && <ProgressPoller url={routes.runStatus(run.publicId)} version={status.version} />}

      <Section title="Overview">
        {!terminal && <ProgressBar value={finished} max={targets.length} label={`${finished} of ${countLabel(targets.length, "repository", "repositories")} finished`} />}
        <StatGroup
          label="Run results"
          stats={[
            { label: "Repository Profiles", value: `${profiles.size}/${targets.length}` },
            // Its completeness is a status, not a figure; and a map with nothing in it isn't offered.
            map && coverage && profiles.size > 0
              ? { label: "Relationship Map", value: <Status state={coverage.complete ? "complete" : "partial"} label={coverage.complete ? "Complete" : "Partial"} />, status: true, hint: <Link href={routes.runMap(run.publicId)}>Review the Relationship Map</Link> }
              : { label: "Relationship Map", value: "—", hint: terminal ? "Nothing was mapped" : "Written when every repository finishes" },
            { label: "Coverage gaps", value: coverage ? coverage.gaps.length : "—" },
            { label: "Evaluations", value: evaluations.length, hint: evaluations.length || evaluable ? undefined : terminal ? "No results to evaluate" : "Available once finished" },
          ]}
        />
      </Section>

      <ScopeSection targets={targets} profiles={profiles} commits={targetCommits(db, run.id)} live={(ids) => liveRepositoryIds(db, ids)} terminal={terminal} requested={param(query, "page")} href={(page) => withQuery(routes.run(run.publicId, { page: pageQuery(page) }), {}, "repositories")} />

      {evaluations.length > 0 && (
        <Section title="Evaluations">
          <Panel flush>
            <Table
              label="Evaluations of this Run"
              head={
                <>
                  <Th>Evaluation</Th>
                  <Th>Status</Th>
                  <Th>Finished</Th>
                </>
              }
            >
              {evaluations.map((evaluation) => (
                <tr key={evaluation.publicId}>
                  <Td label="Evaluation">
                    <Primary>
                      <Link href={routes.evaluation(evaluation.publicId)}>{`Evaluation #${evaluationNumber.get(evaluation.id)}`}</Link>
                    </Primary>
                  </Td>
                  <Td label="Status">
                    <Status state={evaluation.state} />
                  </Td>
                  <Td label="Finished">
                    <RelativeTime value={evaluation.finishedAt} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </Section>
      )}

      <Disclosure summary="Details" variant="plain">
        <DescriptionList surface
          items={[
            [SURVEYOR_RELEASE_LABEL, <Tag key="release">{run.surveyorRelease}</Tag>],
            ["Configuration digest", <ShortValue key="digest" value={run.configurationDigest} label="digest" />],
            ["Created", <RelativeTime key="created" value={run.createdAt} />],
            ["Started", <RelativeTime key="started" value={run.startedAt} />],
            ["Finished", <RelativeTime key="finished" value={run.finishedAt} />],
            ["ID", <Tag key="id" copy label="ID">{run.publicId}</Tag>],
          ]}
        />
      </Disclosure>
    </DetailsTemplate>
  );
}

/**
 * While a Run runs, its results are partial, and canceling it is its one
 * action. Cancel Run sits here, with the in-progress state and in view
 * without scrolling, never in the page header, which holds no destructive
 * action (page-patterns spec).
 */
function InProgressAlert({ runId, name }: { runId: string; name: string }) {
  return (
    <Alert
      tone="info"
      title="Results are partial until every repository finishes"
      actions={
        <ConfirmDialog action={cancelRun.bind(null, runId)} trigger={{ label: "Cancel Run", icon: "slash", size: "sm" }} title={`Cancel ${name}?`} confirmLabel="Cancel Run" tone="danger">
          <p>Repositories that have not finished stop at their next check. Completed Profiles are kept.</p>
        </ConfirmDialog>
      }
    >
      The Relationship Map is written, and Evaluations can start, once they all have.
    </Alert>
  );
}

/** The Run's scope as it was when it started, and each repository's progress and Profile. */
function ScopeSection({ targets, profiles, commits, live, terminal, requested, href }: { targets: RunTarget[]; profiles: Map<number, RepositoryProfile>; commits: Map<number, string>; live: (publicIds: string[]) => Set<string>; terminal: boolean; requested: string | undefined; href: (page: number) => string }) {
  // Fifty to a page, so a fleet-sized Run reads only the Profiles it shows.
  const { rows, page, pages } = pageOf(targets, requested);
  // Each repository links to its page, unless it has since been deleted.
  const existing = live(rows.map((target) => target.repositoryPublicId));
  const skippedInputs = (targetId: number) => {
    const profile = profiles.get(targetId);
    return profile ? profileDiagnostics(profileDocument(profile)).skipped.length : 0;
  };
  return (
    <Section id="repositories" title="Repositories" description="The scope as it was when the Run started, and each repository's progress.">
      <Panel flush>
        <Table
          label="Run scope"
          head={
            <>
              <Th>Repository</Th>
              <Th>Reference</Th>
              <Th>Status</Th>
              <Th>Profile</Th>
            </>
          }
        >
          {rows.map((target) => {
            const commit = commits.get(target.id);
            const profile = profiles.get(target.id);
            const skipped = skippedInputs(target.id);
            return (
              <tr key={target.publicId} id={target.publicId}>
                <Td label="Repository">
                  <Primary>{existing.has(target.repositoryPublicId) ? <Link href={routes.repository(target.repositoryPublicId)}>{target.repositoryName}</Link> : target.repositoryName}</Primary>
                  <Secondary>
                    <Tag>{target.cloneUrl}</Tag>
                  </Secondary>
                </Td>
                <Td label="Reference">
                  {target.gitRef ? <Tag>{target.gitRef}</Tag> : humanize(targetReferenceLabel(target))}
                  {commit && (
                    <Secondary>
                      <ShortValue value={commit} label="commit" />
                    </Secondary>
                  )}
                </Td>
                <Td label="Status">
                  <Status state={target.state} />
                  {target.state === "failed" && <FailureReason code={target.failureCode} message={target.failureMessage} />}
                </Td>
                <Td label="Profile">
                  {profile ? (
                    <>
                      <Link href={routes.profile(profile.publicId)} aria-label={`${target.repositoryName} Profile`}>
                        Profile
                      </Link>
                      {skipped > 0 && <Secondary>{countLabel(skipped, "skipped input")}</Secondary>}
                    </>
                  ) : (
                    <Secondary>{terminal || target.state === "failed" || target.state === "canceled" ? "None" : "Pending"}</Secondary>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
      <Pagination label="Run scope pages" page={page} pages={pages} href={href} scrollToTop />
    </Section>
  );
}
