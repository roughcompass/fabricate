import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ProgressPoller } from "@/components/progress-poller";
import { StatusBadge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ShortSha, Timestamp, countLabel } from "@/components/ui/format";
import { Card, DetailsList, Page, PageHeader, ui } from "@/components/ui/layout";
import { Notice } from "@/components/ui/notice";
import { Mono, Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { findAssessment, snapshotOf, targetReferenceLabel, targetsOf } from "@/lib/assessments/assessment-records";
import { assessmentStatus } from "@/lib/assessments/status";
import { getDb } from "@/lib/db/client";
import { initiatives } from "@/lib/db/schema";
import { ASSESSMENT_MACHINE, isTerminal } from "@/lib/db/state-machines";
import { listEvaluations } from "@/lib/evaluations/evaluation-records";
import { profileDiagnostics, profileDocument, profilesOf } from "@/lib/profiles/profile-records";
import { mapDocument, mapOf } from "@/lib/relationships/map-records";
import type { MapDocument } from "@/lib/relationships/schema";
import { cancelAssessment } from "../actions";

export const metadata: Metadata = { title: "Assessment" };

const NOTICES: Record<string, [tone: "success" | "info" | "warning", message: string]> = {
  started: ["success", "The assessment was started."],
  "already-started": ["info", "This assessment was already started; no duplicate work was created."],
  "cancel-requested": ["info", "Cancellation was requested. Work that has not finished stops at its next check; completed Profiles are kept."],
  "already-finished": ["info", "The assessment had already finished, so there was nothing to cancel."],
};

export default async function AssessmentPage({ params, searchParams }: { params: Promise<{ assessmentId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ assessmentId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const assessment = findAssessment(db, assessmentId);
  if (!assessment) notFound();

  const initiative = db.select().from(initiatives).where(eq(initiatives.id, assessment.initiativeId)).get()!;
  const targets = targetsOf(db, assessment.id);
  const profiles = new Map(profilesOf(db, assessment.id).map(({ profile, target }) => [target.id, profile]));
  const map = mapOf(db, assessment.id);
  const coverage = map ? (mapDocument(map) as unknown as MapDocument).coverage : null;
  const evaluations = listEvaluations(db, { assessmentId: assessment.id });
  const status = assessmentStatus(db, assessment);
  const terminal = isTerminal(ASSESSMENT_MACHINE, assessment.state);
  const failed = targets.filter((target) => target.state === "failed");
  const notice = typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const skippedInputs = (targetId: number) => {
    const profile = profiles.get(targetId);
    return profile ? profileDiagnostics(profileDocument(profile)).skipped.length : 0;
  };

  return (
    <Page>
      {!status.terminal && <ProgressPoller url={`/api/assessments/${assessment.publicId}/status`} version={status.version} />}
      <PageHeader
        title={`Assessment ${assessment.publicId}`}
        back={{ href: `/initiatives/${initiative.publicId}`, label: initiative.name }}
        badge={<StatusBadge state={assessment.state} />}
        description="Each scoped repository is pinned to a commit and analyzed without running its code. This scope was frozen when the assessment started."
        actions={
          !terminal && !assessment.cancelRequestedAt ? (
            <ConfirmButton action={cancelAssessment.bind(null, assessment.publicId)} fields={{}} confirmation="Cancel this assessment? Work that has not finished stops; completed Profiles are kept." icon="slash">
              Cancel assessment
            </ConfirmButton>
          ) : undefined
        }
      />

      {notice && (
        <Notice tone={notice[0]} live>
          {notice[1]}
        </Notice>
      )}
      {!terminal && assessment.cancelRequestedAt && (
        <Notice tone="info" live>
          Cancellation requested. Unfinished repositories stop at their next check.
        </Notice>
      )}
      {assessment.state === "complete" && <Notice tone="success">Every scoped repository was assessed.</Notice>}
      {assessment.state === "complete_with_issues" && (
        <Notice tone="warning" title={`${failed.length} of ${targets.length} repositories could not be assessed`}>
          Results from the others are available. The Relationship Map marks each missing repository as a coverage gap, and Evaluations treat what it could hold as unknown.
        </Notice>
      )}
      {assessment.state === "failed" && (
        <Notice tone="warning" title="No repository could be assessed">
          {assessment.failureReason ?? "Every repository failed to be acquired or analyzed."}
        </Notice>
      )}
      {assessment.state === "canceled" && (
        <Notice tone="info" title="The assessment was canceled">
          {`${countLabel(profiles.size, "completed Profile")} ${profiles.size === 1 ? "remains" : "remain"} reviewable. Repositories that had not finished were not analyzed.`}
        </Notice>
      )}

      <Card title="Results" description="Available once repositories finish. Results never change after they are written.">
        <DetailsList
          items={[
            ["Repository Profiles", `${profiles.size} of ${targets.length}`],
            [
              "Relationship Map",
              map && coverage ? (
                <span key="map">
                  <Link href={`/assessments/${assessment.publicId}/map`}>Review the Relationship Map</Link>
                  {coverage.gaps.length > 0 && <Secondary>{`${countLabel(coverage.gaps.length, "coverage gap")}`}</Secondary>}
                </span>
              ) : (
                <span key="map" className={ui.muted}>
                  {terminal ? "Not available" : "Written when every repository finishes"}
                </span>
              ),
            ],
            [
              "Evaluations",
              evaluations.length ? (
                <ul key="evaluations" className={ui.plainList}>
                  {evaluations.map((evaluation) => (
                    <li key={evaluation.publicId}>
                      <Link href={`/evaluations/${evaluation.publicId}`}>
                        <Mono>{evaluation.publicId}</Mono>
                      </Link>{" "}
                      <StatusBadge state={evaluation.state} />
                    </li>
                  ))}
                </ul>
              ) : (
                <span key="evaluations" className={ui.muted}>
                  None yet. Start one from the Initiative once this assessment finishes.
                </span>
              ),
            ],
          ]}
        />
      </Card>

      <Card title="Scope and progress" description="Source configuration as it was when the assessment started, and each repository's progress." flush>
        <Table
          label="Assessment scope"
          head={
            <>
              <Th>Source</Th>
              <Th>Clone URL</Th>
              <Th>Reference</Th>
              <Th>Status</Th>
              <Th>Profile</Th>
            </>
          }
        >
          {targets.map((target) => {
            const snapshot = snapshotOf(db, target.id);
            const profile = profiles.get(target.id);
            const skipped = skippedInputs(target.id);
            return (
              <tr key={target.publicId} id={target.publicId}>
                <Td label="Source">
                  <Primary>{target.sourceName}</Primary>
                  <Secondary mono>{target.sourcePublicId}</Secondary>
                </Td>
                <Td label="Clone URL">
                  <Mono>{target.cloneUrl}</Mono>
                </Td>
                <Td label="Reference">
                  {target.gitRef ? <Mono>{target.gitRef}</Mono> : <span className={ui.muted}>{targetReferenceLabel(target)}</span>}
                  {snapshot && (
                    <Secondary>
                      <ShortSha sha={snapshot.commitSha} />
                    </Secondary>
                  )}
                </Td>
                <Td label="Status">
                  <StatusBadge state={target.state} />
                  {target.failureCode && <Secondary mono>{target.failureCode}</Secondary>}
                  {target.failureMessage && <Secondary>{target.failureMessage}</Secondary>}
                </Td>
                <Td label="Profile">
                  {profile ? (
                    <>
                      <Link href={`/profiles/${profile.publicId}`}>{`View ${target.sourceName} Profile`}</Link>
                      {skipped > 0 && <Secondary>{countLabel(skipped, "skipped input")}</Secondary>}
                    </>
                  ) : (
                    <span className={ui.muted}>{terminal || target.state === "failed" || target.state === "canceled" ? "None" : "Pending"}</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="Recorded inputs">
        <DetailsList
          items={[
            ["Detector release", <Mono key="release">{assessment.detectorRelease}</Mono>],
            ["Configuration digest", <Mono key="digest">{assessment.configurationDigest.slice(0, 12)}</Mono>],
            ["Created", <Timestamp key="created" value={assessment.createdAt} />],
            ["Started", <Timestamp key="started" value={assessment.startedAt} />],
            ["Finished", <Timestamp key="finished" value={assessment.finishedAt} />],
          ]}
        />
      </Card>
    </Page>
  );
}
