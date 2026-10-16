import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { launchAssessment } from "@/lib/assessments/launcher";
import { ScopeResolutionError } from "@/lib/assessments/scope-resolver";
import { getSource } from "@/lib/catalog/source-records";
import { type FabricateConfig, getConfig } from "@/lib/config";
import { type Executor, immediate } from "@/lib/db/client";
import { TransitionError } from "@/lib/db/errors";
import { type AssessmentState, applicationAssessments, applications, assessmentTargets, assessments, repositorySources } from "@/lib/db/schema";
import { DE_WEB_INITIATIVE_ID } from "@/lib/initiatives/initiative-records";
import { getApplication } from "./applications";

/*
 * An Application's DE Web assessments (rendering-assessment spec; design
 * decision 6). Creating or re-assessing an Application launches a Run of
 * the DE Web initiative scoped to its repository and links the two; a Run
 * that can't start is recorded with why, so the dashboard can say so and
 * offer Re-run. The launch never waits for the Run.
 */

/** Run states in which an assessment is still to finish. */
export const ACTIVE_RUN_STATES = ["queued", "acquiring", "analyzing", "finalizing"] as const;

/** Why a launch failed, in words that carry no credential or internal detail. */
function launchProblem(error: unknown): string {
  if (error instanceof ScopeResolutionError) return error.message.slice(0, 500) || "The assessment couldn't start";
  return "The assessment couldn't start";
}

/** The Application's queued or running DE Web assessment, if any. */
export function activeApplicationAssessment(db: Executor, applicationId: number) {
  return db
    .select({ id: assessments.id, publicId: assessments.publicId, state: assessments.state })
    .from(applicationAssessments)
    .innerJoin(assessments, eq(assessments.id, applicationAssessments.assessmentId))
    .where(and(eq(applicationAssessments.applicationId, applicationId), inArray(assessments.state, [...ACTIVE_RUN_STATES])))
    .orderBy(desc(applicationAssessments.id))
    .limit(1)
    .get();
}

export type LaunchOutcome = { started: true; assessmentPublicId: string } | { started: false; problem: string };

/**
 * Starts a DE Web assessment of the Application's repository at its
 * configured reference, and links it to the Application. A second launch
 * while one is queued or running is refused; a launch that fails is
 * recorded, not thrown.
 */
export function launchApplicationAssessment(db: Executor, applicationPublicId: string, config: FabricateConfig = getConfig(), launchToken: string = crypto.randomUUID()): LaunchOutcome {
  return immediate(db, (tx) => {
    const application = getApplication(tx, applicationPublicId);
    if (application.repositorySourceId === null) throw new TransitionError(`${application.name ?? application.publicId} has no repository to assess`);
    if (activeApplicationAssessment(tx, application.id)) throw new TransitionError(`An assessment of ${application.name ?? application.publicId} is already queued or running`);
    const source = getSource(tx, tx.select({ publicId: repositorySources.publicId }).from(repositorySources).where(eq(repositorySources.id, application.repositorySourceId)).get()!.publicId);

    const now = new Date();
    let outcome: LaunchOutcome;
    try {
      const { assessment } = launchAssessment(tx, DE_WEB_INITIATIVE_ID, launchToken, config, { sources: [source] });
      tx.insert(applicationAssessments).values({ applicationId: application.id, assessmentId: assessment.id, startedAt: now }).run();
      outcome = { started: true, assessmentPublicId: assessment.publicId };
    } catch (error) {
      const problem = launchProblem(error);
      if (!(error instanceof ScopeResolutionError)) console.error(`The DE Web assessment of ${application.publicId} couldn't start:`, error);
      tx.insert(applicationAssessments).values({ applicationId: application.id, error: problem, startedAt: now }).run();
      outcome = { started: false, problem };
    }
    tx.update(applications).set({ updatedAt: now }).where(eq(applications.id, application.id)).run();
    return outcome;
  });
}

export interface LatestLaunch {
  /** Why the launch couldn't start, when it couldn't. */
  error: string | null;
  startedAt: Date;
  assessment: { id: number; publicId: string; state: AssessmentState } | null;
}

/** The latest launch of each Application, keyed by application row id: its Run, or why it couldn't start. One query. */
export function latestLaunches(db: Executor): Map<number, LatestLaunch> {
  const rows = db.all<{ application_id: number; error: string | null; started_at: number; assessment_id: number | null; public_id: string | null; state: AssessmentState }>(sql`
    select l.application_id, l.error, l.started_at, a.id as assessment_id, a.public_id, a.state
    from ${applicationAssessments} l left join ${assessments} a on a.id = l.assessment_id
    where l.id in (select max(id) from ${applicationAssessments} group by application_id)`);
  return new Map(
    rows.map((row) => [row.application_id, { error: row.error, startedAt: new Date(row.started_at), assessment: row.assessment_id !== null && row.public_id ? { id: row.assessment_id, publicId: row.public_id, state: row.state } : null }]),
  );
}

/** An Application's assessment state, as its dashboard and card show it (rendering-assessment spec, "Assessment state is tracked per application"). */
export const APPLICATION_ASSESSMENT_STATES = ["not_assessed", "couldnt_start", "queued", "assessing", "assessed", "assessed_with_issues", "failed", "canceled"] as const;
export type ApplicationAssessmentStateId = (typeof APPLICATION_ASSESSMENT_STATES)[number];

/** Which Run states each Application state covers. */
const RUN_STATE_MAP: Record<AssessmentState, ApplicationAssessmentStateId> = {
  queued: "queued",
  acquiring: "assessing",
  analyzing: "assessing",
  finalizing: "assessing",
  complete: "assessed",
  complete_with_issues: "assessed_with_issues",
  failed: "failed",
  canceled: "canceled",
};

export function applicationStateOfRun(state: AssessmentState): ApplicationAssessmentStateId {
  return RUN_STATE_MAP[state];
}

/** Why a repository couldn't be read, by its acquisition failure code, in words with no credential or internal detail. */
const FAILURE_REASONS: Record<string, string> = {
  authentication_failed: "The repository couldn't be read: DE FabLab has no credential for its host, or the host refused it",
  source_unavailable: "The repository couldn't be read: it wasn't found, or its host didn't answer",
  boundary_violation: "The repository couldn't be read: it's outside the roots DE FabLab may read",
  invalid_ref: "The repository couldn't be read: its configured reference doesn't exist",
  ambiguous_ref: "The repository couldn't be read: its configured reference names more than one commit",
  timeout: "The repository couldn't be read in time",
  unsupported_repository: "The repository couldn't be assessed: it uses a feature DE FabLab doesn't support",
};

export interface ApplicationAssessmentState {
  state: ApplicationAssessmentStateId;
  /** The latest Run, when one started. */
  run: { publicId: string; state: AssessmentState } | null;
  /** Why it failed or couldn't start. */
  reason: string | null;
  /** Whether a Run is queued or running, so Re-run assessment is unavailable. */
  active: boolean;
  startedAt: Date | null;
}

/** The state of the Application's latest DE Web assessment, from its Run, with a failure's reason. */
export function applicationAssessmentState(db: Executor, applicationId: number): ApplicationAssessmentState {
  const launch = db.select().from(applicationAssessments).where(eq(applicationAssessments.applicationId, applicationId)).orderBy(desc(applicationAssessments.id)).limit(1).get();
  if (!launch) return { state: "not_assessed", run: null, reason: null, active: false, startedAt: null };
  if (launch.assessmentId === null) return { state: "couldnt_start", run: null, reason: launch.error, active: false, startedAt: launch.startedAt };
  const run = db.select({ publicId: assessments.publicId, state: assessments.state }).from(assessments).where(eq(assessments.id, launch.assessmentId)).get()!;
  const state = applicationStateOfRun(run.state);
  let reason: string | null = null;
  if (state === "failed") {
    const application = db.select({ sourceId: applications.repositorySourceId }).from(applications).where(eq(applications.id, applicationId)).get();
    const target = db
      .select({ code: assessmentTargets.failureCode })
      .from(assessmentTargets)
      .where(and(eq(assessmentTargets.assessmentId, launch.assessmentId), eq(assessmentTargets.repositorySourceId, application?.sourceId ?? -1)))
      .get();
    reason = (target?.code && FAILURE_REASONS[target.code]) || "The repository couldn't be assessed";
  }
  return { state, run, reason, active: (ACTIVE_RUN_STATES as readonly string[]).includes(run.state), startedAt: launch.startedAt };
}
