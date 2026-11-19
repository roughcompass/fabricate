import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgressPoller } from "@/components/progress-poller";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { countLabel } from "@/components/ui/count";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { StatGroup } from "@/components/ui/stat-group";
import { Status, humanize } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { ShortValue, Tag } from "@/components/ui/tag";
import { type AssessmentTarget, targetReferenceLabel, targetsOf } from "@/lib/assessments/assessment-records";
import { targetCommits } from "@/lib/surveys/records";
import { assessmentStatus } from "@/lib/assessments/status";
import { getDb } from "@/lib/db/client";
import { ASSESSMENT_MACHINE, isTerminal, TARGET_MACHINE } from "@/lib/db/state-machines";
import { evaluationNumbers, listEvaluations } from "@/lib/evaluations/evaluation-records";
import { profileDiagnostics, profileDocument, profilesOf, type RepositoryProfile } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { cancelAssessment } from "../actions";
import { assessmentOutcome } from "../outcomes";
import { routes } from "@/lib/web/routes";
import { loadRun } from "./load";
import { SURVEYOR_RELEASE_LABEL } from "@/lib/product";

export async function generateMetadata({ params }: PageProps<"/runs/[assessmentId]">): Promise<Metadata> {
  const found = loadRun((await params).assessmentId);
  return { title: found ? `${found.context.name} · ${found.context.owner}` : "Run not found" };
}

export default async function AssessmentPage({ params, searchParams }: PageProps<"/runs/[assessmentId]">) {
  const [{ assessmentId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const found = loadRun(assessmentId);
  if (!found) notFound();
  const { assessment, initiative, context } = found;
  const { name } = context;

  const targets = targetsOf(db, assessment.id);
  const profiles = new Map(profilesOf(db, assessment.id).map(({ profile, target }) => [target.id, profile]));
  const map = mapOf(db, assessment.id);
  const coverage = map ? (mapDocument(map) as unknown as MapDocument).coverage : null;
  const evaluationNumber = evaluationNumbers(db, initiative.id);
  const evaluations = listEvaluations(db, { assessmentId: assessment.id });
  const status = assessmentStatus(db, assessment);
  const terminal = isTerminal(ASSESSMENT_MACHINE, assessment.state);
  const failed = targets.filter((target) => target.state === "failed");
  const finished = targets.filter((target) => isTerminal(TARGET_MACHINE, target.state)).length;
  const shownState = !terminal && assessment.cancelRequestedAt ? "canceling" : assessment.state;

  return (
    <Page>
      {!status.terminal && <ProgressPoller url={routes.runStatus(assessment.publicId)} version={status.version} />}
      <PageHeader
        breadcrumbs={context.parents}
        title={name}
        status={<Status state={shownState} />}
        meta={[
          countLabel(targets.length, "Repository", "Repositories"),
          <span key="started">
            Started <RelativeTime value={assessment.createdAt} />
          </span>,
          ...(assessment.finishedAt
            ? [
                <span key="finished">
                  Finished <RelativeTime value={assessment.finishedAt} />
                </span>,
              ]
            : []),
        ]}
        description="Each scoped repository is pinned to a commit and profiled without running its code."
        extraActions={
          !terminal && !assessment.cancelRequestedAt ? (
            <ConfirmDialog action={cancelAssessment.bind(null, assessment.publicId)} trigger={{ label: "Cancel Run", icon: "slash" }} title={`Cancel ${name}?`} confirmLabel="Cancel Run" tone="danger">
              <p>Repositories that have not finished stop at their next check. Completed Profiles are kept.</p>
            </ConfirmDialog>
          ) : undefined
        }
        alerts={
          <>
            <OutcomeToast outcome={assessmentOutcome(param(query, "notice"), assessment, name)} />
            {assessment.state === "complete_with_issues" && (
              <Alert tone="warning" title={`${failed.length} of ${countLabel(targets.length, "repository", "repositories")} could not be assessed`}>
                <p>{`${failed.map((target) => target.sourceName).join(", ")}: ${failed[0]?.failureMessage ?? "not assessed"}${failed.length > 1 ? " (and more below)" : ""}.`}</p>
                <p>Their relationships are missing from the Relationship Map, and Evaluations treat what they could contain as unknown.</p>
              </Alert>
            )}
            {assessment.state === "failed" && (
              <Alert tone="error" title="No repository could be assessed">
                {/* The stored reason often repeats the title; the rows below give each repository's reason. */}
                {assessment.failureReason && !/^No repository could be assessed\.?$/i.test(assessment.failureReason) ? assessment.failureReason : "Each repository's reason is listed below."}
              </Alert>
            )}
            {assessment.state === "canceled" && (
              <Alert tone="info" title={`${countLabel(profiles.size, "completed Profile")} ${profiles.size === 1 ? "remains" : "remain"} reviewable.`}>
                Repositories that had not finished when the Run was canceled were not profiled.
              </Alert>
            )}
          </>
        }
      />

      <Section title="Overview">
        {!terminal && <ProgressBar value={finished} max={targets.length} label={`${finished} of ${countLabel(targets.length, "repository", "repositories")} finished`} />}
        <StatGroup
          label="Run results"
          stats={[
            { label: "Repository Profiles", value: `${profiles.size}/${targets.length}` },
            map && coverage
              ? { label: "Relationship Map", value: coverage.complete ? "Complete" : "Partial", hint: <Link href={routes.runMap(assessment.publicId)}>Review the Relationship Map</Link> }
              : { label: "Relationship Map", value: "—", hint: terminal ? "Not available" : "Written when every repository finishes" },
            { label: "Coverage gaps", value: coverage ? coverage.gaps.length : "—" },
            { label: "Evaluations", value: evaluations.length, hint: evaluations.length ? undefined : terminal ? "Start one from the Assessment" : "Available once finished" },
          ]}
        />
      </Section>

      <ScopeSection targets={targets} profiles={profiles} commits={targetCommits(db, assessment.id)} terminal={terminal} />

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
            [SURVEYOR_RELEASE_LABEL, <Tag key="release">{assessment.detectorRelease}</Tag>],
            ["Configuration digest", <ShortValue key="digest" value={assessment.configurationDigest} label="digest" />],
            ["Created", <RelativeTime key="created" value={assessment.createdAt} />],
            ["Started", <RelativeTime key="started" value={assessment.startedAt} />],
            ["Finished", <RelativeTime key="finished" value={assessment.finishedAt} />],
            ["ID", <Tag key="id" copy label="ID">{assessment.publicId}</Tag>],
          ]}
        />
      </Disclosure>
    </Page>
  );
}

/** The Run's scope as it was when it started, and each repository's progress and Profile. */
function ScopeSection({ targets, profiles, commits, terminal }: { targets: AssessmentTarget[]; profiles: Map<number, RepositoryProfile>; commits: Map<number, string>; terminal: boolean }) {
  const skippedInputs = (targetId: number) => {
    const profile = profiles.get(targetId);
    return profile ? profileDiagnostics(profileDocument(profile)).skipped.length : 0;
  };
  return (
    <Section title="Repositories" description="The scope as it was when the Run started, and each repository's progress.">
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
          {targets.map((target) => {
            const commit = commits.get(target.id);
            const profile = profiles.get(target.id);
            const skipped = skippedInputs(target.id);
            return (
              <tr key={target.publicId} id={target.publicId}>
                <Td label="Repository">
                  <Primary>{target.sourceName}</Primary>
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
                  {target.failureMessage && <Secondary>{target.failureMessage}</Secondary>}
                  {target.failureCode && <Secondary mono>{target.failureCode}</Secondary>}
                </Td>
                <Td label="Profile">
                  {profile ? (
                    <>
                      <Link href={routes.profile(profile.publicId)} aria-label={`${target.sourceName} Profile`}>
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
    </Section>
  );
}
