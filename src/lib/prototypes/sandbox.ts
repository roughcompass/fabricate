import { Sandbox } from "@vercel/sandbox";
import { and, desc, eq } from "drizzle-orm";
import { NotFoundError } from "@/lib/db/errors";
import { generatePublicId } from "@/lib/db/ids";
import type { PrototypesExecutor } from "./db/client";
import { prototypes, sandboxRuns, versions } from "./db/schema";
import { projectFiles } from "./export";
import { PrototypesLimitError } from "./limits";
import { exportedPrototypeVersion } from "./template-files";

/**
 * Open in Vercel Sandbox (preview spec, "A version can run as a standalone
 * app on Vercel Sandbox"; design.md, decision 14). The version's downloadable
 * project is written into a new sandbox, installed from the npm registry,
 * which is the only address the sandbox may reach, and started with Vite. Its
 * address is public, and the sandbox stops 30 minutes after it starts.
 */

export type SandboxRun = typeof sandboxRuns.$inferSelect;

export const SANDBOX_PORT = 5173;
export const SANDBOX_MINUTES = 30;
/** The only host a sandbox may reach: the npm registry, for installing the project. */
export const SANDBOX_ALLOWED_HOSTS = ["registry.npmjs.org"] as const;
const READY_TIMEOUT_MS = 90_000;

/** A Vercel OIDC token, or an access token with its team and project (design.md, decision 3). */
export function sandboxConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  // On Vercel, functions get their OIDC token with each request rather than in the environment.
  if (env.VERCEL === "1" || env.VERCEL_OIDC_TOKEN?.trim()) return true;
  return Boolean(env.VERCEL_TOKEN?.trim() && env.VERCEL_TEAM_ID?.trim() && env.VERCEL_PROJECT_ID?.trim());
}

export const SANDBOX_UNCONFIGURED = "Vercel Sandbox isn't configured here: it needs a Vercel OIDC token, or VERCEL_TOKEN with VERCEL_TEAM_ID and VERCEL_PROJECT_ID.";

function credentials(env: Readonly<Record<string, string | undefined>> = process.env) {
  // With an OIDC token, from the environment or Vercel's request context, the SDK authenticates itself.
  if (env.VERCEL === "1" || env.VERCEL_OIDC_TOKEN?.trim()) return {};
  return { token: env.VERCEL_TOKEN!, teamId: env.VERCEL_TEAM_ID!, projectId: env.VERCEL_PROJECT_ID! };
}

/** Starts a run for a ready version of the workspace's prototypes, or refuses before any sandbox is created. Returns the run's id. */
export async function startSandboxRun(db: PrototypesExecutor, workspaceId: string, versionId: string, now = new Date()): Promise<string> {
  if (!sandboxConfigured()) throw new PrototypesLimitError(SANDBOX_UNCONFIGURED);
  const [version] = await db
    .select({ status: versions.status })
    .from(versions)
    .where(and(eq(versions.workspaceId, workspaceId), eq(versions.id, versionId)));
  if (!version) throw new NotFoundError("Unknown version");
  if (version.status !== "ready") throw new PrototypesLimitError("Only a ready version can run in Vercel Sandbox.");
  const id = generatePublicId("sbx");
  await db.insert(sandboxRuns).values({ id, workspaceId, versionId, stage: "Creating the sandbox", createdAt: now });
  return id;
}

/** The latest run of a version, if any. */
export async function latestSandboxRun(db: PrototypesExecutor, workspaceId: string, versionId: string): Promise<SandboxRun | null> {
  const [run] = await db
    .select()
    .from(sandboxRuns)
    .where(and(eq(sandboxRuns.workspaceId, workspaceId), eq(sandboxRuns.versionId, versionId)))
    .orderBy(desc(sandboxRuns.createdAt))
    .limit(1);
  return run ?? null;
}

/** Whether a run's sandbox is still up: ready and before its stop time. */
export function sandboxLive(run: Pick<SandboxRun, "status" | "stopsAt">, now = new Date()): boolean {
  return run.status === "ready" && Boolean(run.stopsAt && run.stopsAt > now);
}

/** Creates the sandbox, writes and installs the project, starts it, and records its public address. */
export async function runSandbox(db: PrototypesExecutor, runId: string): Promise<void> {
  const [row] = await db
    .select({ run: sandboxRuns, version: versions, name: prototypes.name })
    .from(sandboxRuns)
    .innerJoin(versions, eq(versions.id, sandboxRuns.versionId))
    .innerJoin(prototypes, eq(prototypes.id, versions.prototypeId))
    .where(eq(sandboxRuns.id, runId));
  if (!row || row.run.status !== "starting") return;
  const stage = (text: string, extra: Partial<SandboxRun> = {}) => db.update(sandboxRuns).set({ stage: text, ...extra }).where(eq(sandboxRuns.id, runId));
  const { version } = row;
  let sandbox: Sandbox | null = null;
  try {
    sandbox = await Sandbox.create({ ...credentials(), ports: [SANDBOX_PORT], timeout: SANDBOX_MINUTES * 60_000, networkPolicy: { allow: [...SANDBOX_ALLOWED_HOSTS] } });
    const stopsAt = new Date(Date.now() + SANDBOX_MINUTES * 60_000);
    await stage("Writing the project", { sandboxId: sandbox.name, stopsAt });
    const exported = await exportedPrototypeVersion(db, version.id, row.run.workspaceId);
    if (!exported) throw new Error("The version is no longer ready.");
    const files = projectFiles(exported);
    await sandbox.writeFiles(Object.entries(files).map(([path, content]) => ({ path, content })));
    await stage("Installing dependencies");
    const install = await sandbox.runCommand({ cmd: "npm", args: ["install", "--no-audit", "--no-fund", "--loglevel=error"] });
    if (install.exitCode !== 0) throw new Error(`npm install failed: ${(await install.stderr()).slice(-400)}`);
    await stage("Starting the app");
    await sandbox.runCommand({ cmd: "npm", args: ["run", "dev", "--", "--host", "0.0.0.0", "--port", String(SANDBOX_PORT)], detached: true });
    const url = sandbox.domain(SANDBOX_PORT);
    await waitForApp(url);
    await db.update(sandboxRuns).set({ status: "ready", stage: null, url }).where(eq(sandboxRuns.id, runId));
  } catch (error) {
    await db.update(sandboxRuns).set({ status: "failed", stage: null, error: error instanceof Error ? error.message : String(error) }).where(eq(sandboxRuns.id, runId));
    await sandbox?.stop().catch(() => undefined);
  }
}

/** Waits until the app answers at its public address. */
async function waitForApp(url: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(url, { cache: "no-store" }).catch(() => null);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`The app didn't answer at ${url} within ${READY_TIMEOUT_MS / 1000} seconds.`);
}
