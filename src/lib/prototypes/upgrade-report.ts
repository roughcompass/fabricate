import { and, eq, inArray } from "drizzle-orm";
import type { ControlRecheck } from "./conformance";
import { getPrototypesDb } from "./db/client";
import { templateRechecks } from "./db/schema";
import { templatesAvailable } from "./guard";
import { liveTemplates } from "./templates";
import type { GateResult } from "./types";

/**
 * The upgrade report (template-conformance spec, "An upgrade report lists
 * every template's results"; design decision 10 of
 * converge-templates-and-prototypes): after the re-checks for one runtime
 * build finish, every live template's latest version, each gate and each
 * Control, at acceptance and after the upgrade, classified exactly as
 * `salt-fleet-crater` classifies a check. These checks are deterministic,
 * so crater's rerun for flaky results doesn't apply.
 */

export type CheckResult = "passes" | "fails";
export type CraterResult = "unchanged" | "regressed" | "fixed" | "broken";

export interface ReportRow {
  readonly template: string;
  readonly templateVersion: number;
  /** "Gate" or the Release a Control belongs to. */
  readonly source: string;
  readonly check: string;
  readonly baseline: CheckResult;
  /** Null when the upgrade's Assessment failed, so the Control has no result. */
  readonly candidate: CheckResult | null;
  readonly result: CraterResult;
}

export interface UpgradeReport {
  readonly runtimeHash: string;
  readonly saltRelease: string;
  readonly coverage: string;
  readonly badges: string;
  readonly counts: Readonly<Record<CraterResult, number>>;
  readonly rows: readonly ReportRow[];
}

export const COVERAGE = "These checks don't cover appearance, CSS overrides, or behavior in a deployed environment. An unchanged result doesn't mean a template is safe to ship, and a broken one is indeterminate, never safe.";

export const BADGES =
  "Results use salt-fleet-crater's terms: unchanged passes both times, regressed passed at acceptance and fails now, fixed failed at acceptance and passes now, and broken fails both times or has no result now. The gallery's badges differ: its Broken means a gate fails now, which is regressed here; its Regressed means a new gate warning or a Control that stopped meeting, which is regressed here for that Control.";

const GATE_NAMES: Record<string, string> = { "salt-only": "Salt-only gate", typecheck: "Typecheck gate", "salt-usage": "Salt usage gate", build: "Build gate" };

/** crater's classification of one check (salt-fleet-crater differential-run spec, "Results report differences"). */
export function craterResult(baseline: CheckResult, candidate: CheckResult | null): CraterResult {
  if (candidate === null) return "broken";
  if (baseline === "passes") return candidate === "passes" ? "unchanged" : "regressed";
  return candidate === "passes" ? "fixed" : "broken";
}

/** Meets and Not applicable pass a Control; a Gap or an Indeterminate Finding fails it. */
const controlResult = (outcome: string): CheckResult => (outcome === "meets" || outcome === "not_applicable" ? "passes" : "fails");

export interface ReportEntry {
  readonly template: string;
  readonly templateVersion: number;
  readonly acceptedGates: readonly GateResult[];
  readonly recheckGates: readonly GateResult[];
  /** Null for a version that wasn't evaluated at acceptance, which has gates only. */
  readonly controls: ControlRecheck | null;
}

/** The report for one runtime build from each template's re-check, in template order. */
export function buildUpgradeReport(runtimeHash: string, saltRelease: string, entries: readonly ReportEntry[]): UpgradeReport {
  const rows = [...entries]
    .sort((left, right) => left.template.localeCompare(right.template, "en") || left.templateVersion - right.templateVersion)
    .flatMap((entry): ReportRow[] => {
      const base = { template: entry.template, templateVersion: entry.templateVersion };
      const gates = entry.acceptedGates.map((accepted): ReportRow => {
        const now = entry.recheckGates.find((result) => result.gate === accepted.gate);
        const baseline: CheckResult = accepted.status === "failed" ? "fails" : "passes";
        const candidate: CheckResult | null = now ? (now.status === "failed" ? "fails" : "passes") : null;
        return { ...base, source: "Gate", check: GATE_NAMES[accepted.gate] ?? accepted.gate, baseline, candidate, result: craterResult(baseline, candidate) };
      });
      const controls = (entry.controls?.controls ?? []).map((change): ReportRow => {
        const baseline = controlResult(change.before);
        const candidate = change.after === null ? null : controlResult(change.after);
        return { ...base, source: change.release, check: change.control, baseline, candidate, result: craterResult(baseline, candidate) };
      });
      return [...gates, ...controls];
    });
  const counts = { unchanged: 0, regressed: 0, fixed: 0, broken: 0 };
  for (const row of rows) counts[row.result]++;
  return { runtimeHash, saltRelease, coverage: COVERAGE, badges: BADGES, counts, rows };
}

const cell = (text: string) => text.replaceAll("|", "\\|");

/** The report as Markdown, with crater's columns. */
export function reportMarkdown(report: UpgradeReport): string {
  const { counts } = report;
  return [
    `# Salt Patterns upgrade report: Salt ${report.saltRelease}`,
    "",
    `Runtime build \`${report.runtimeHash}\`. ${counts.unchanged} unchanged, ${counts.regressed} regressed, ${counts.fixed} fixed, ${counts.broken} broken.`,
    "",
    `> ${report.coverage}`,
    "",
    report.badges,
    "",
    "| Template | Version | Source | Check | Baseline | Candidate | Result |",
    "|---|---|---|---|---|---|---|",
    ...report.rows.map((row) => `| ${cell(row.template)} | v${row.templateVersion} | ${cell(row.source)} | ${cell(row.check)} | ${row.baseline} | ${row.candidate ?? "no result"} | ${row.result === "broken" ? "broken (indeterminate)" : row.result} |`),
    "",
  ].join("\n");
}

/** The report for a runtime build, or how many re-checks for it are still pending; null when no live template was re-checked for it. */
export async function upgradeReportFor(runtimeHash: string): Promise<UpgradeReport | { readonly pending: number } | null> {
  const db = await getPrototypesDb();
  const latest = (await liveTemplates(db)).map((template) => template.latest);
  if (latest.length === 0) return null;
  const rechecks = await db
    .select()
    .from(templateRechecks)
    .where(and(eq(templateRechecks.runtimeHash, runtimeHash), inArray(templateRechecks.templateVersionId, latest.map((version) => version.id))));
  if (rechecks.length === 0) return null;
  const byVersion = new Map(rechecks.map((recheck) => [recheck.templateVersionId, recheck]));
  // Controls live in SQLite, which only the deployments that offer Accept have; elsewhere the report has gates only.
  const controlsOf = templatesAvailable()
    ? await Promise.all([import("@/lib/db/client"), import("./conformance")]).then(([{ getDb }, { controlRecheck }]) => (version: (typeof latest)[number], recheck: (typeof rechecks)[number]) => controlRecheck(getDb(), version.standards, recheck.standards))
    : () => null;
  let pending = 0;
  const entries: ReportEntry[] = [];
  for (const version of latest) {
    const recheck = byVersion.get(version.id);
    if (!recheck?.status) {
      pending++;
      continue;
    }
    const controls = controlsOf(version, recheck);
    if (controls?.status === "pending") {
      pending++;
      continue;
    }
    entries.push({ template: version.title, templateVersion: version.number, acceptedGates: version.snapshot.gates, recheckGates: recheck.gates ?? [], controls });
  }
  if (pending > 0) return { pending };
  return buildUpgradeReport(runtimeHash, rechecks[0]!.saltRelease, entries);
}
