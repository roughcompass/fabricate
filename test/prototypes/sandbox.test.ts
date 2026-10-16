import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import type { PrototypesConnection } from "@/lib/prototypes/db/client";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { SANDBOX_ALLOWED_HOSTS, SANDBOX_MINUTES, sandboxConfigured, sandboxLive, startSandboxRun } from "@/lib/prototypes/sandbox";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/preview spec, "A version can run as a standalone app on Vercel Sandbox".

describe("Vercel Sandbox", () => {
  let connection: PrototypesConnection;
  beforeEach(async () => {
    connection = await createPrototypesTestDb();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await connection.close();
  });

  it("is configured by an OIDC token, or an access token with its team and project", () => {
    expect(sandboxConfigured({})).toBe(false);
    expect(sandboxConfigured({ VERCEL_OIDC_TOKEN: "token" })).toBe(true);
    expect(sandboxConfigured({ VERCEL: "1" })).toBe(true);
    expect(sandboxConfigured({ VERCEL_TOKEN: "token", VERCEL_TEAM_ID: "team" })).toBe(false);
    expect(sandboxConfigured({ VERCEL_TOKEN: "token", VERCEL_TEAM_ID: "team", VERCEL_PROJECT_ID: "project" })).toBe(true);
  });

  it("refuses to start without credentials, before any sandbox is created (Not configured)", async () => {
    for (const key of ["VERCEL_OIDC_TOKEN", "VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"]) vi.stubEnv(key, "");
    const workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
    await expect(startSandboxRun(connection.db, workspaceId, "ver_aaaaaaaaaaaaaaaa")).rejects.toThrow(PrototypesLimitError);
  });

  it("reaches only the npm registry, and stops after 30 minutes", () => {
    expect(SANDBOX_ALLOWED_HOSTS).toEqual(["registry.npmjs.org"]);
    expect(SANDBOX_MINUTES).toBe(30);
    const now = new Date("2026-10-16T09:00:00.000Z");
    expect(sandboxLive({ status: "ready", stopsAt: new Date(now.getTime() + 60_000) }, now)).toBe(true);
    expect(sandboxLive({ status: "ready", stopsAt: new Date(now.getTime() - 1) }, now)).toBe(false);
    expect(sandboxLive({ status: "starting", stopsAt: null }, now)).toBe(false);
  });
});
