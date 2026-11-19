import { createApplication } from "@/lib/applications/pipeline";
import type { Repository } from "@/lib/repositories/repository-records";
import type { FrontendRegistryConfig } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import type { ArtifactLayout } from "@/lib/db/schema";
import type { PackageVerdict } from "@/lib/previews/eligibility";
import { PREPARE_PREVIEW, type PreviewPreparation, decidePreparation, openPreparation } from "@/lib/previews/records";
import { requestSurvey } from "@/lib/surveys/records";
import { rawRun } from "./db";

/*
 * Applications over decided preparations written straight into the
 * database, for record and pipeline tests that need neither Git nor a
 * survey. Builds are then published or failed with test/support/previews.ts.
 */

let commits = 0;

/** A new commit SHA, distinct from every other this module made. */
export function nextCommit(): string {
  return (++commits).toString(16).padStart(8, "0").padStart(40, "c");
}

/** A package that qualifies, built with Vite and pnpm, using React. */
export function qualifyingVerdict(directory = ".", options: { name?: string; layout?: ArtifactLayout; framework?: string } = {}): PackageVerdict {
  const framework = options.framework ?? "react";
  const label = { react: "React", vue: "Vue", svelte: "Svelte" }[framework] ?? framework;
  return {
    directory,
    manifest: directory === "." ? "package.json" : `${directory}/package.json`,
    name: options.name ?? "orders-portal",
    qualifies: true,
    conditions: [
      { condition: "framework", passed: true, reason: `${label} runs in the browser`, facts: [{ category: "frameworks", key: `package.json#${framework}`, state: "observed", value: { id: framework, label }, evidence: [] }] },
      { condition: "build_tool", passed: true, reason: "Builds with Vite", facts: [{ category: "build_tools", key: "vite", state: "observed", value: { id: "vite", label: "Vite" }, evidence: [] }] },
    ],
    plan: { installRoot: ".", packageManager: { name: "pnpm", version: "9.1.0", lockfile: "pnpm-lock.yaml" }, buildTool: "vite", buildScript: "vite build", node: { version: "22.11.0", ranges: [] }, layout: options.layout ?? "standalone", composition: null },
  };
}

/** A package that doesn't qualify: no supported build tool. */
export function refusedVerdict(directory = "."): PackageVerdict {
  return {
    directory,
    manifest: directory === "." ? "package.json" : `${directory}/package.json`,
    name: "ledger",
    qualifies: false,
    conditions: [
      { condition: "framework", passed: true, reason: "React runs in the browser", facts: [] },
      { condition: "build_tool", passed: false, reason: "No supported build tool applies to this package. Previews support Vite, webpack, Rspack, and Rsbuild.", facts: [] },
    ],
    plan: null,
  };
}

/**
 * The preparation of +commitSha+ of +repository+, decided with +packages+:
 * Ready when one qualifies, else Refused. Its job is removed, so only what
 * it starts is queued.
 */
export function decidedPreparation(db: Db, repository: Repository, packages: PackageVerdict[] = [qualifyingVerdict()], commitSha = nextCommit(), refName = "refs/heads/main"): PreviewPreparation {
  const { preparation } = openPreparation(db, repository, { commitSha, refName, refKind: "branch" });
  return decide(db, repository, preparation, packages);
}

/** The preparation +preparation+, still profiling, decided with +packages+, as its job would. */
export function decide(db: Db, repository: Repository, preparation: PreviewPreparation, packages: PackageVerdict[] = [qualifyingVerdict()]): PreviewPreparation {
  const { survey } = requestSurvey(db, { repositoryId: repository.id, commitSha: preparation.commitSha, reference: preparation.refName ?? preparation.commitSha, fromConfiguredReference: false, trigger: "preview", surveyorRelease: "0.0.0", configurationDigest: "f".repeat(64), profileSchemaVersion: 2 });
  const qualifies = packages.some((verdict) => verdict.qualifies);
  const refusal = qualifies ? null : { reason: "No package qualifies for a preview", conditions: packages.flatMap((verdict) => verdict.conditions.filter((condition) => !condition.passed).map((condition) => ({ ...condition, package: verdict.directory }))) };
  const decided = decidePreparation(db, preparation.publicId, preparation.requestedAt.getTime(), { surveyId: survey.id, digest: "f".repeat(64) }, { packages, refusal });
  rawRun(db, "delete from jobs where kind = ?", PREPARE_PREVIEW);
  if (!decided) throw new Error(`${preparation.publicId} was no longer profiling`);
  return decided;
}

/** An application of +repository+'s package +packageDir+, created from a decided preparation of a new commit on +branch+. */
export function onboard(db: Db, config: FrontendRegistryConfig, repository: Repository, options: { name?: string; description?: string; packageDir?: string; branch?: string; preparation?: PreviewPreparation; framework?: string } = {}) {
  const packageDir = options.packageDir ?? ".";
  const preparation = options.preparation ?? decidedPreparation(db, repository, [qualifyingVerdict(packageDir, { framework: options.framework })]);
  return createApplication(db, { repository: repository.publicId, branch: options.branch ?? "main", packageDir, preparation: preparation.publicId, name: options.name ?? "Orders portal", description: options.description ?? "Order tracking for partners" }, config);
}
