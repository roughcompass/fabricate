import { and, eq, isNull, lt } from "drizzle-orm";
import { generatePublicId } from "@/lib/db/ids";
import type { PrototypesExecutor } from "./db/client";
import { type RecheckStatus, templateRechecks, templateVersions } from "./db/schema";
import { portalAllowed, runGates } from "./gates";
import { templatesAvailable } from "./guard";
import { RUNTIME } from "./render";
import type { TemplateRecheck, TemplateVersion } from "./templates";
import type { GateIssue, GateResult } from "./types";

/**
 * Re-checking templates after a Salt upgrade (versions spec, "Accepted
 * templates are re-checked after a Salt upgrade" and "Re-check results are
 * classified and shown"; design.md, decision 17). A template version is stale
 * when the runtime build it was last checked with differs from the current
 * one. The first request that sees it stale claims the re-check, which
 * recompiles the code and runs the four deterministic gates. A version that
 * was evaluated at acceptance also has its export, as built for the new
 * runtime, assessed and evaluated against its acceptance's Releases
 * (converge-templates-and-prototypes, design decision 10). No model is
 * called, and the template version never changes.
 */

/** A claim that ran this long without finishing is taken to have crashed, and may be claimed again. */
export const RECHECK_TIMEOUT_MS = 10 * 60 * 1000;

export const RECHECK_LABELS: Readonly<Record<RecheckStatus, string>> = { unchanged: "Unchanged", fixed: "Fixed", regressed: "Regressed", broken: "Broken" };

/** The runtime build a version was last checked with: its latest re-check's, or its acceptance's. */
export function checkedHash(version: Pick<TemplateVersion, "snapshot">, recheck: Pick<TemplateRecheck, "runtimeHash"> | null): string {
  return recheck?.runtimeHash ?? version.snapshot.runtimeHash;
}

export function isStale(version: Pick<TemplateVersion, "snapshot">, recheck: Pick<TemplateRecheck, "runtimeHash"> | null, runtimeHash: string = RUNTIME.hash): boolean {
  return checkedHash(version, recheck) !== runtimeHash;
}

const key = (gate: GateResult["gate"], issue: GateIssue) => `${gate}:${issue.code}:${issue.symbol ?? ""}:${issue.message}`;
const warningKeys = (results: readonly GateResult[]) => new Set(results.flatMap((result) => result.warnings.map((warning) => key(result.gate, warning))));

/**
 * Compares a re-check's gate results with those recorded at acceptance:
 * Broken when a gate fails, Regressed when a new warning appears, Fixed when
 * a warning is gone and none is new, and otherwise Unchanged.
 */
export function classifyRecheck(accepted: readonly GateResult[], now: readonly GateResult[]): RecheckStatus {
  if (now.some((result) => result.status === "failed")) return "broken";
  const before = warningKeys(accepted);
  const after = warningKeys(now);
  if ([...after].some((warning) => !before.has(warning))) return "regressed";
  if ([...before].some((warning) => !after.has(warning))) return "fixed";
  return "unchanged";
}

/**
 * Claims the re-check of one template version for this runtime build, at
 * most once: the unique index on version and hash makes the insert the
 * claim, and a claim that timed out is taken over by one conditional update.
 * Returns the re-check's id, or null when another request holds it or it is done.
 */
export async function claimRecheck(db: PrototypesExecutor, templateVersionId: string, runtimeHash: string = RUNTIME.hash, saltRelease: string = RUNTIME.packages["@salt-ds/core"], now = new Date()): Promise<string | null> {
  const [claimed] = await db
    .insert(templateRechecks)
    .values({ id: generatePublicId("rck"), templateVersionId, runtimeHash, saltRelease, claimedAt: now })
    .onConflictDoNothing()
    .returning({ id: templateRechecks.id });
  if (claimed) return claimed.id;
  const [retaken] = await db
    .update(templateRechecks)
    .set({ claimedAt: now })
    .where(and(eq(templateRechecks.templateVersionId, templateVersionId), eq(templateRechecks.runtimeHash, runtimeHash), isNull(templateRechecks.status), lt(templateRechecks.claimedAt, new Date(now.getTime() - RECHECK_TIMEOUT_MS))))
    .returning({ id: templateRechecks.id });
  return retaken?.id ?? null;
}

/** Runs a claimed re-check: recompiles the version's code, runs the four gates, and stores the classified result. */
export async function runRecheck(db: PrototypesExecutor, recheckId: string, now = () => new Date()): Promise<RecheckStatus | null> {
  const [row] = await db
    .select({ recheck: templateRechecks, version: templateVersions })
    .from(templateRechecks)
    .innerJoin(templateVersions, eq(templateVersions.id, templateRechecks.templateVersionId))
    .where(eq(templateRechecks.id, recheckId));
  if (!row || row.recheck.status) return row?.recheck.status ?? null;
  const { snapshot } = row.version;
  try {
    const run = await runGates({ code: snapshot.code, data: snapshot.sampleData?.source ?? "", styles: snapshot.styles ?? null, portal: portalAllowed(snapshot.provenance) });
    const status = classifyRecheck(snapshot.gates, run.results);
    const standards = await assessForStandards(db, row.version);
    await db.update(templateRechecks).set({ status, gates: [...run.results], compiled: run.compiled, standards, finishedAt: now() }).where(eq(templateRechecks.id, recheckId));
    return status;
  } catch (error) {
    // The gates themselves failed to run; the claim times out and another request retries it.
    await db.update(templateRechecks).set({ error: error instanceof Error ? error.message : String(error) }).where(eq(templateRechecks.id, recheckId));
    return null;
  }
}

/**
 * Starts the Salt Patterns Run of a version's export for the current runtime
 * build, to be evaluated against its acceptance's Releases. Only where
 * Standards are (SQLite is loaded lazily, so the hosted profile never loads
 * it), and only for versions evaluated at acceptance. Returns what the
 * re-check records, or null.
 */
async function assessForStandards(db: PrototypesExecutor, version: typeof templateVersions.$inferSelect): Promise<{ assessmentId: string; releaseIds: string[] } | null> {
  if (!templatesAvailable() || version.standards?.status !== "evaluated") return null;
  const [{ getDb }, { acceptanceReleaseIds }, { launchTemplateAssessment }, { templateTargetFiles }] = await Promise.all([import("@/lib/db/client"), import("./conformance"), import("@/lib/assessments/template-launcher"), import("./template-files")]);
  const sqlite = getDb();
  const releaseIds = acceptanceReleaseIds(sqlite, version.standards.evaluationId);
  if (!releaseIds?.length) return null;
  const { assessment } = await launchTemplateAssessment(
    sqlite,
    { key: version.templateId, name: version.title, templatePublicId: version.templateId, templateVersionPublicId: version.id, templateVersionNumber: version.number, prototypeVersionPublicId: version.snapshot.versionId },
    { templateFiles: (ref) => templateTargetFiles(ref, db), evaluationReleases: releaseIds },
  );
  return { assessmentId: assessment.publicId, releaseIds };
}

/**
 * Claims a re-check for every stale version among these, and hands each claim
 * to `start`, which runs it through the generation runner. The request itself
 * renders with the last known status. Returns the claimed re-checks.
 */
export async function recheckStale(
  db: PrototypesExecutor,
  candidates: readonly { readonly version: Pick<TemplateVersion, "id" | "snapshot">; readonly recheck: Pick<TemplateRecheck, "runtimeHash"> | null }[],
  start: (recheckId: string) => Promise<void>,
  runtimeHash: string = RUNTIME.hash,
): Promise<string[]> {
  const claimed: string[] = [];
  for (const { version, recheck } of candidates) {
    if (!isStale(version, recheck, runtimeHash)) continue;
    const id = await claimRecheck(db, version.id, runtimeHash);
    if (!id) continue;
    claimed.push(id);
    await start(id);
  }
  return claimed;
}

/** The gates a re-check failed, for naming why Use template is unavailable. */
export function failingGates(recheck: Pick<TemplateRecheck, "gates"> | null): GateResult[] {
  return (recheck?.gates ?? []).filter((result) => result.status === "failed");
}
