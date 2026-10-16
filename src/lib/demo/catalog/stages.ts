import type { StageScript } from "./types";

export interface StageContext {
  readonly templateSlug: string;
  readonly templateVersion: string;
  readonly url: string;
  readonly project?: string | null;
  readonly repository?: string | null;
  readonly repositoryUrl?: string | null;
}

/** The scripted stages of a simulated sandbox build, about 10 seconds end to end. */
function sandboxStages(context: StageContext): StageScript[] {
  return [
    { name: "Queued", durationMs: 500, lines: ["Build queued on a sandbox runner"] },
    { name: "Cloning template", durationMs: 1200, lines: [`Cloning ${context.templateSlug}@${context.templateVersion}`, "Resolved template release"] },
    { name: "Installing dependencies", durationMs: 2500, lines: ["Installing packages from the lockfile", "Added 1,214 packages in 2.4s"] },
    { name: "Building", durationMs: 3000, lines: ["Building microfrontends", "Built 3 microfrontends and the portal shell"] },
    { name: "Deploying to sandbox", durationMs: 1800, lines: ["Uploading build output", "Promoting the sandbox deployment"] },
    { name: "Assigning URL", durationMs: 800, lines: [`Assigned ${context.url}`] },
  ];
}

/** The scripted stages of a simulated dev environment build, about 15 seconds end to end. */
function devStages(context: StageContext): StageScript[] {
  const repository = `${context.project}/${context.repository}`;
  return [
    { name: "Queued", durationMs: 500, lines: ["Build queued on a dev runner"] },
    { name: `Creating BitBucket repository ${repository}`, durationMs: 1500, lines: [`Created ${context.repositoryUrl}`, "Applied branch permissions"] },
    { name: "Pushing initial commit", durationMs: 1200, lines: [`Pushed ${context.templateSlug}@${context.templateVersion} to main`] },
    { name: "Running pipeline #1", durationMs: 2000, lines: ["Pipeline #1 started on main", "Lint, type, and unit checks passed"] },
    { name: "Installing dependencies", durationMs: 2500, lines: ["Installing packages from the lockfile", "Added 1,214 packages in 2.4s"] },
    { name: "Building", durationMs: 3500, lines: ["Building microfrontends", "Built the template's microfrontends; the portal shell falls back to production"] },
    { name: "Deploying to dev", durationMs: 2500, lines: ["Uploading build output", "Promoting the dev deployment"] },
    { name: "Assigning URL", durationMs: 800, lines: [`Assigned ${context.url}`] },
  ];
}

export function stagesFor(environment: "sandbox" | "dev", context: StageContext): StageScript[] {
  return environment === "sandbox" ? sandboxStages(context) : devStages(context);
}

export function totalDuration(stages: readonly StageScript[]): number {
  return stages.reduce((total, stage) => total + stage.durationMs, 0);
}
