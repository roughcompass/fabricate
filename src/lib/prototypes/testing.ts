import { and, eq, sql } from "drizzle-orm";
import { GATEWAY_CREDENTIALS, getConfig, setConfig, withOverrides } from "@/lib/config";
import { generatePublicId } from "@/lib/db/ids";
import { e2eRoutesEnabled } from "@/lib/testing/e2e";
import { migratePrototypesDatabase, openPrototypesDatabase, replacePrototypesDb } from "./db/client";
import { type TemplateStandards, prototypes, templateRechecks, templateVersions, templates, versions, workspaces } from "./db/schema";
import { prototypesRequest } from "./request";
import { RUNTIME } from "./render";
import type { Provenance, Scope } from "./types";

/**
 * Browser-test support for Prototypes, behind the same switch as the rest of
 * DE FabLab's test routes: FABRICATE_E2E=1 outside production. PGlite allows
 * one process, so tests seed through these routes instead of opening the
 * store themselves.
 */
export { e2eRoutesEnabled };

const saved = globalThis as typeof globalThis & { __fabricateE2eCredentials?: Record<string, string | undefined> };

/**
 * Lets a browser test run the server as an environment without a model
 * credential: real model ids, and AI Gateway credentials removed from this
 * process. The next reset restores both.
 */
export function withoutModelCredentials(): void {
  saved.__fabricateE2eCredentials ??= Object.fromEntries(GATEWAY_CREDENTIALS.map((key) => [key, process.env[key]]));
  for (const key of GATEWAY_CREDENTIALS) delete process.env[key];
  setConfig(withOverrides(getConfig(), { prototypes: { models: { generate: "anthropic/claude-opus-5.5", plan: "anthropic/claude-sonnet-5.5", review: "google/gemini-3.1-pro-preview", learn: "anthropic/claude-sonnet-5.5" } } }));
}

/** Runs the server's Prototypes jobs inline or as Workflows until the next reset. */
export function selectRunner(runner: "workflow" | "inline"): void {
  setConfig(withOverrides(getConfig(), { prototypes: { runner } }));
}

/** Turns Prototypes on or off until the next reset. */
export function withPrototypesEnabled(enabled: boolean): void {
  setConfig(withOverrides(getConfig(), { prototypes: { enabled } }));
}

/** Seeds new workspaces with the committed example prototypes, or not, until the next reset. */
export function withExamples(examples: boolean): void {
  setConfig(withOverrides(getConfig(), { prototypes: { examples } }));
}

function restoreSettings(): void {
  const credentials = saved.__fabricateE2eCredentials;
  if (credentials) for (const [key, value] of Object.entries(credentials)) if (value !== undefined) process.env[key] = value;
  saved.__fabricateE2eCredentials = undefined;
  setConfig(undefined);
}

/**
 * Replaces the Prototypes store with an empty, migrated one in memory, and
 * restores the server's settings. A request from the previous test may still
 * be running, so the old store closes a few seconds later rather than at once.
 */
export async function resetPrototypesE2eData(): Promise<void> {
  restoreSettings();
  const connection = await openPrototypesDatabase({ kind: "memory" });
  await migratePrototypesDatabase(connection);
  const previous = replacePrototypesDb(connection);
  if (previous) setTimeout(() => void previous.then((old) => old?.close()).catch(() => undefined), 5_000);
}

export interface FixtureVersion {
  readonly name?: string;
  readonly scope: Scope;
  readonly title?: string;
  readonly navItem?: string | null;
  readonly code: string;
  readonly data?: string;
  readonly compiled: string;
}

/** A prototype at version 1 in the visitor's workspace, from code a test supplies. */
export async function createFixturePrototype(fixture: FixtureVersion): Promise<{ prototypeId: string; versionId: string }> {
  const { db, workspace } = await prototypesRequest();
  const prototypeId = generatePublicId("pro");
  const versionId = generatePublicId("ver");
  await db.transaction(async (tx) => {
    await tx.insert(prototypes).values({ id: prototypeId, workspaceId: workspace.id, name: fixture.name ?? "Fixture prototype", scope: fixture.scope, latestNumber: 1 });
    const provenance: Provenance = {
      model: "fixture",
      personas: [],
      intent: fixture.name ?? "A browser-test fixture",
      message: null,
      scope: fixture.scope,
      direction: null,
      lessons: [],
      saltGuidance: [],
      saltRelease: RUNTIME.packages["@salt-ds/core"] ?? "",
      registryRelease: RUNTIME.packages["@salt-ds/core"] ?? "",
      kitVersion: "fixture",
      parentVersionId: null,
      forkedFrom: null,
      startedFromTemplate: null,
      createdAt: new Date().toISOString(),
    };
    await tx.insert(versions).values({
      id: versionId,
      workspaceId: workspace.id,
      prototypeId,
      number: 1,
      status: "ready",
      scope: fixture.scope,
      title: fixture.title ?? "Fixture",
      navItem: fixture.navItem ?? null,
      code: fixture.code,
      sampleData: { description: "fixture data", source: fixture.data ?? "export {};\n" },
      compiled: fixture.compiled,
      gatesPassed: true,
      provenance,
      fit: { status: "not-applicable", model: null, personas: [], average: null, at: provenance.createdAt },
    });
    await tx.update(workspaces).set({ prototypeCount: sql`${workspaces.prototypeCount} + 1` }).where(eq(workspaces.id, workspace.id));
  });
  return { prototypeId, versionId };
}

/**
 * Makes a template's latest version look accepted on an earlier runtime
 * build, as after a Salt upgrade, optionally with other code, so the next
 * gallery or detail request re-checks it (design.md, decision 17).
 */
/** Points a template's latest version at another Run and Evaluation, such as ones that don't exist, as if they were recorded at acceptance. */
export async function recordTemplateStandards(slug: string, standards: TemplateStandards): Promise<{ versionId: string } | null> {
  const { db } = await prototypesRequest();
  const [row] = await db
    .select({ id: templateVersions.id })
    .from(templateVersions)
    .innerJoin(templates, eq(templates.id, templateVersions.templateId))
    .where(and(eq(templates.slug, slug), eq(templateVersions.number, templates.latestNumber)));
  if (!row) return null;
  await db.update(templateVersions).set({ standards }).where(eq(templateVersions.id, row.id));
  return { versionId: row.id };
}

export async function staleTemplate(slug: string, code?: string): Promise<{ versionId: string } | null> {
  const { db } = await prototypesRequest();
  const [row] = await db
    .select({ version: templateVersions })
    .from(templateVersions)
    .innerJoin(templates, eq(templates.id, templateVersions.templateId))
    .where(and(eq(templates.slug, slug), eq(templateVersions.number, templates.latestNumber)));
  if (!row) return null;
  const snapshot = { ...row.version.snapshot, runtimeHash: "earlier-build", code: code ?? row.version.snapshot.code };
  await db.update(templateVersions).set({ snapshot }).where(eq(templateVersions.id, row.version.id));
  // The upgrade comes after any earlier re-check, so the next request re-checks it again.
  await db.delete(templateRechecks).where(eq(templateRechecks.templateVersionId, row.version.id));
  return { versionId: row.version.id };
}
