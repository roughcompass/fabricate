import { createHash } from "node:crypto";
import type { JsonObject } from "@repo-facts/contract";
import { and, desc, eq } from "drizzle-orm";
import { assessmentTargets } from "@/lib/db/schema";
import { treeObjectId } from "@/lib/snapshot/stored-files";
import { type Assessment, findAssessment, targetsOf } from "@/lib/assessments/assessment-records";
import { type TemplateLaunchOptions, launchTemplateAssessment } from "@/lib/assessments/template-launcher";
import type { Executor } from "@/lib/db/client";
import { type Evaluation, type Finding, evaluationReleasesOf, findEvaluation, findingDocument, findingsOf, listEvaluations } from "@/lib/evaluations/evaluation-records";
import { saltPatternsInitiative, selectedReleases } from "@/lib/initiatives/initiative-records";
import { releaseById, releaseLabel, standardById } from "@/lib/standards/standard-records";
import type { BlockingFinding, Conformance, ReleaseResult } from "./conformance-result";
import type { TemplateStandards } from "./db/schema";

export { type BlockingFinding, type Conformance, type ReleaseResult, confirmable } from "./conformance-result";

/**
 * Conformance at acceptance (template-conformance spec;
 * converge-templates-and-prototypes, design decision 3): a page version being
 * accepted is assessed under the Salt Patterns initiative and evaluated
 * against its selected Releases. Accept can be confirmed only when no
 * selected Release has a Gap or an Indeterminate Finding, or, with no Release
 * selected, on the gate and accessibility rules alone.
 *
 * Everything here reads SQLite by public id; nothing in the Prototypes
 * database is trusted to say a version passed.
 */

/** How long a Run or its Evaluation may wait for its first job before the step says the worker isn't running. */
export const WORKER_GRACE_MS = 20_000;

/** Whether the Salt Patterns initiative selects any Release, so acceptance waits for an Evaluation. */
export function evaluationRequired(db: Executor): boolean {
  return selectedReleases(db, saltPatternsInitiative(db).id).length > 0;
}

/** What starting acceptance names: the version, and the template it would publish to, if any. */
export interface CandidateVersion {
  prototypeId: string;
  name: string;
  versionId: string;
  templateId: string | null;
}

/** Starts the check of a candidate version, or reports Not evaluated when no Release is selected. Returns the Run's id, or null. */
export async function startConformance(db: Executor, candidate: CandidateVersion, options: TemplateLaunchOptions = {}): Promise<string | null> {
  if (!evaluationRequired(db)) return null;
  // The template version doesn't exist until acceptance, so the Run names the prototype version; its key stays the template's when there is one.
  const { assessment } = await launchTemplateAssessment(
    db,
    { key: candidate.templateId ?? candidate.prototypeId, name: candidate.name, templatePublicId: null, templateVersionPublicId: null, templateVersionNumber: null, prototypeVersionPublicId: candidate.versionId },
    options,
  );
  return assessment.publicId;
}

/** The Run of +versionId+ named +assessmentId+, if it is a Salt Patterns Run of that version. */
export function candidateRun(db: Executor, assessmentId: string, versionId: string): Assessment | null {
  const assessment = findAssessment(db, assessmentId);
  if (!assessment || assessment.initiativeId !== saltPatternsInitiative(db).id) return null;
  const [target] = targetsOf(db, assessment.id);
  return target?.kind === "template" && target.prototypeVersionPublicId === versionId ? assessment : null;
}

/** Where a candidate's check stands, from its Run's id; null when no Run was started because no Release is selected. */
export function conformanceOf(db: Executor, assessmentId: string | null, versionId: string, now = new Date()): Conformance {
  if (assessmentId === null) return evaluationRequired(db) ? { status: "unavailable", assessmentId: null } : { status: "not_evaluated", reason: "no_release" };
  const assessment = candidateRun(db, assessmentId, versionId);
  if (!assessment) return { status: "unavailable", assessmentId };
  const waited = now.getTime() - assessment.createdAt.getTime() > WORKER_GRACE_MS;

  if (assessment.state === "failed" || assessment.state === "canceled") {
    const [target] = targetsOf(db, assessment.id);
    return { status: "failed", assessmentId, reason: target?.failureMessage ?? assessment.failureReason ?? "The Run didn't finish." };
  }
  if (assessment.state !== "complete" && assessment.state !== "complete_with_issues") {
    return { status: "running", stage: "assessing", assessmentId, stalled: assessment.state === "queued" && waited };
  }

  const [evaluation] = listEvaluations(db, { assessmentId: assessment.id });
  if (!evaluation) {
    // A finished Run is evaluated in the transaction it finishes in; with Releases selected, a missing Evaluation means one couldn't start.
    return evaluationRequired(db) ? { status: "unavailable", assessmentId } : { status: "not_evaluated", reason: "no_release" };
  }
  if (evaluation.state === "failed") return { status: "failed", assessmentId, reason: evaluation.failureReason ?? "The Evaluation didn't finish." };
  if (evaluation.state !== "complete") {
    const stalled = evaluation.state === "queued" && now.getTime() - evaluation.createdAt.getTime() > WORKER_GRACE_MS;
    return { status: "running", stage: "evaluating", assessmentId, stalled };
  }

  const { releases, findings, labelOf } = releaseResults(db, evaluation);
  const blocking = findings.filter((finding) => finding.outcome === "gap" || finding.outcome === "indeterminate").map((finding) => blockingFinding(finding, labelOf(finding.standardReleaseId), evaluation.publicId));
  return { status: "evaluated", assessmentId, evaluationId: evaluation.publicId, releases, blocking };
}

/** Each Release an Evaluation pinned, with its position, label, and Finding counts, in label order. */
function releaseResults(db: Executor, evaluation: Evaluation): { releases: ReleaseResult[]; findings: Finding[]; labelOf: (releaseId: number) => string } {
  const pinned = evaluationReleasesOf(db, evaluation.id);
  const labels = new Map(
    pinned.map((entry) => {
      const release = releaseById(db, entry.standardReleaseId);
      return [entry.standardReleaseId, { label: releaseLabel(standardById(db, release.standardId), release), publicId: release.publicId, position: entry.position }] as const;
    }),
  );
  const results = new Map<number, ReleaseResult>([...labels].map(([id, entry]) => [id, { ...entry, counts: { meets: 0, gap: 0, indeterminate: 0, not_applicable: 0 } }]));
  const findings = findingsOf(db, evaluation.id);
  for (const finding of findings) results.get(finding.standardReleaseId)!.counts[finding.outcome]++;
  return { releases: [...results.values()].sort((a, b) => a.label.localeCompare(b.label)), findings, labelOf: (releaseId) => labels.get(releaseId)?.label ?? "" };
}

/** What a template version shows about its Standards: Meets, Gaps found, or Not evaluated with why; never Meets without its Evaluation. */
export interface TemplateStanding {
  status: "meets" | "gaps" | "not_evaluated";
  reason: string | null;
  evaluationId: string | null;
  releases: ReleaseResult[];
}

/** A template version's standing from what its acceptance recorded, read from SQLite (template-conformance spec, "A missing Evaluation never reads as passing"). */
export function templateStanding(db: Executor, standards: TemplateStandards | null): TemplateStanding {
  const notEvaluated = (reason: string): TemplateStanding => ({ status: "not_evaluated", reason, evaluationId: null, releases: [] });
  if (standards === null) return notEvaluated("It was accepted before templates were evaluated against Standards.");
  if (standards.status === "not_evaluated") return notEvaluated("No Release was selected on Salt Patterns when it was accepted.");
  const evaluation = findEvaluation(db, standards.evaluationId);
  if (!evaluation || evaluation.state !== "complete") return notEvaluated("Its Evaluation is unavailable.");
  const { releases } = releaseResults(db, evaluation);
  const blocked = releases.some((release) => release.counts.gap > 0 || release.counts.indeterminate > 0);
  return { status: blocked ? "gaps" : "meets", reason: null, evaluationId: evaluation.publicId, releases };
}

const COMPARATOR_WORDS: Record<string, string> = { eq: "", lt: "less than ", lte: "at most ", gt: "more than ", gte: "at least " };

function blockingFinding(finding: Finding, release: string, evaluationId: string): BlockingFinding {
  const document = findingDocument(finding);
  const control = document.control as JsonObject;
  const condition = (document.condition ?? null) as JsonObject | null;
  const expected = (control.condition ?? null) as JsonObject | null;
  const observed =
    finding.outcome === "gap" && condition && "observed" in condition && expected?.op === "compare" ? `Observed ${String(condition.observed)}; expected ${COMPARATOR_WORDS[String(expected.comparator)] ?? ""}${String(expected.value)}` : null;
  const causes = Array.isArray(document.causes) ? document.causes.map((cause) => String((cause as JsonObject).reason)) : [];
  return { release, control: String(control.title), outcome: finding.outcome as "gap" | "indeterminate", observed, causes, href: `/evaluations/${evaluationId}/findings/${finding.publicId}` };
}

/** The published Releases, by public id, a template version's acceptance was evaluated against; null when that Evaluation can't be found. */
export function acceptanceReleaseIds(db: Executor, evaluationId: string): string[] | null {
  const evaluation = findEvaluation(db, evaluationId);
  if (!evaluation) return null;
  return evaluationReleasesOf(db, evaluation.id).map((pinned) => releaseById(db, pinned.standardReleaseId).publicId);
}

export type ControlStatus = "unchanged" | "regressed" | "fixed" | "broken";

/** One Control's result at acceptance and after an upgrade, classified (template-conformance spec, "Re-checks after a Salt upgrade re-evaluate templates"). */
export interface ControlChange {
  readonly release: string;
  readonly key: string;
  readonly control: string;
  readonly before: string;
  /** Null when the re-check's Assessment failed. */
  readonly after: string | null;
  readonly status: ControlStatus;
}

export interface ControlRecheck {
  /** Pending until the re-check's Evaluation finishes. */
  readonly status: ControlStatus | "pending";
  readonly controls: readonly ControlChange[];
  readonly evaluationId: string | null;
}

/** Each Control's acceptance result, by Release public id and Control key, with its labels. */
function controlResults(db: Executor, evaluation: Evaluation): Map<string, { release: string; key: string; control: string; outcome: string }> {
  const { findings, labelOf } = releaseResults(db, evaluation);
  return new Map(
    findings.map((finding) => {
      const release = releaseById(db, finding.standardReleaseId).publicId;
      const control = String((findingDocument(finding).control as JsonObject).title);
      return [`${release}:${finding.controlKey}`, { release: labelOf(finding.standardReleaseId), key: finding.controlKey, control, outcome: finding.outcome }] as const;
    }),
  );
}

/**
 * A template version's re-check against its acceptance, Control by Control:
 * Meets then Meets is unchanged, Meets then not Meets is regressed, not
 * Meets then Meets is fixed, and every Control is broken when the re-check's
 * Assessment failed. Null when either side was never evaluated or can't be
 * found.
 */
export function controlRecheck(db: Executor, acceptance: TemplateStandards | null, recheck: { readonly assessmentId: string } | null): ControlRecheck | null {
  if (acceptance?.status !== "evaluated" || !recheck) return null;
  const accepted = findEvaluation(db, acceptance.evaluationId);
  const assessment = findAssessment(db, recheck.assessmentId);
  if (!accepted || accepted.state !== "complete" || !assessment) return null;
  const before = controlResults(db, accepted);
  if (assessment.state === "failed" || assessment.state === "canceled") {
    return { status: "broken", evaluationId: null, controls: [...before.values()].map((entry) => ({ release: entry.release, key: entry.key, control: entry.control, before: entry.outcome, after: null, status: "broken" })) };
  }
  const [evaluation] = listEvaluations(db, { assessmentId: assessment.id });
  if (!evaluation || evaluation.state !== "complete") return { status: evaluation?.state === "failed" ? "broken" : "pending", evaluationId: evaluation?.publicId ?? null, controls: [] };
  const after = controlResults(db, evaluation);
  const controls = [...before].map(([id, entry]): ControlChange => {
    const now = after.get(id)?.outcome ?? null;
    const met = (outcome: string | null) => outcome === "meets";
    const status: ControlStatus = now === null ? "broken" : met(entry.outcome) && !met(now) ? "regressed" : !met(entry.outcome) && met(now) ? "fixed" : "unchanged";
    return { release: entry.release, key: entry.key, control: entry.control, before: entry.outcome, after: now, status };
  });
  const status: ControlStatus = controls.some((change) => change.status === "broken") ? "broken" : controls.some((change) => change.status === "regressed") ? "regressed" : controls.some((change) => change.status === "fixed") ? "fixed" : "unchanged";
  return { status, evaluationId: evaluation.publicId, controls };
}

const SEVERITY: Record<ControlStatus, number> = { unchanged: 0, fixed: 1, regressed: 2, broken: 3 };

/** A template's re-check status from its gates and its Controls: a regressed Control makes it Regressed unless its gates make it Broken. */
export function combinedRecheckStatus(gates: ControlStatus, controls: ControlRecheck | null): ControlStatus {
  const fromControls = controls && controls.status !== "pending" ? controls.status : "unchanged";
  return SEVERITY[fromControls] > SEVERITY[gates] ? fromControls : gates;
}

/** The deterministic prototype-version id a hero's page is assessed under, since a template target names one and a hero's page has none. */
export function heroVersionId(slug: string): string {
  const digest = createHash("sha256").update(`hero:${slug}`).digest();
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return `ver_${[...digest.subarray(0, 16)].map((byte) => alphabet[byte % alphabet.length]).join("")}`;
}

/**
 * A hero template's standing (template-gallery spec, "A hero template's
 * overview SHALL also show its Evaluation"): the latest Salt Patterns Run of
 * its page's export as committed now, by content digest, and that Run's
 * Evaluation. When none exists and Releases are selected, one starts, and
 * the hero shows Not evaluated until it finishes.
 */
export async function heroStanding(db: Executor, hero: { readonly slug: string; readonly title: string }, files: Readonly<Record<string, string>>): Promise<TemplateStanding> {
  const digest = treeObjectId(files);
  const [run] = db
    .select({ assessmentId: assessmentTargets.assessmentId })
    .from(assessmentTargets)
    .where(and(eq(assessmentTargets.kind, "template"), eq(assessmentTargets.sourcePublicId, hero.slug), eq(assessmentTargets.contentDigest, digest)))
    .orderBy(desc(assessmentTargets.id))
    .limit(1)
    .all();
  if (!run) {
    if (!evaluationRequired(db)) return { status: "not_evaluated", reason: "No Release is selected on Salt Patterns.", evaluationId: null, releases: [] };
    await launchTemplateAssessment(db, { key: hero.slug, name: hero.title, templatePublicId: null, templateVersionPublicId: null, templateVersionNumber: null, prototypeVersionPublicId: heroVersionId(hero.slug) }, { templateFiles: async () => files });
    return { status: "not_evaluated", reason: "Its Evaluation is running.", evaluationId: null, releases: [] };
  }
  const [evaluation] = listEvaluations(db, { assessmentId: run.assessmentId });
  if (!evaluation) return { status: "not_evaluated", reason: evaluationRequired(db) ? "Its Evaluation is running." : "No Release is selected on Salt Patterns.", evaluationId: null, releases: [] };
  if (evaluation.state === "queued" || evaluation.state === "evaluating" || evaluation.state === "finalizing") return { status: "not_evaluated", reason: "Its Evaluation is running.", evaluationId: null, releases: [] };
  return templateStanding(db, { status: "evaluated", assessmentId: "", evaluationId: evaluation.publicId });
}
