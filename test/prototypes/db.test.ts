import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrototypesConnection } from "@/lib/prototypes/db/client";
import { generations, personas, prototypes, variants, versions, workspaces } from "@/lib/prototypes/db/schema";
import type { PersonaCopy } from "@/lib/prototypes/types";
import { createPrototypesTestDb } from "../support/prototypes-db";

describe("Prototypes store", () => {
  let connection: PrototypesConnection;

  beforeEach(async () => {
    connection = await createPrototypesTestDb();
  });

  afterEach(async () => {
    await connection.close();
  });

  it("migrates an in-memory PGlite into the prototypes schema", async () => {
    const tables = (await connection.db.execute(sql`select table_name from information_schema.tables where table_schema = 'prototypes' order by table_name`)) as unknown as { rows: { table_name: string }[] };
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "__drizzle_migrations",
      "benchmark_intents",
      "feedback",
      "generations",
      "lesson_checks",
      "lessons",
      "page_shells",
      "pairwise_reviews",
      "personas",
      "prototypes",
      "sandbox_runs",
      "shares",
      "template_rechecks",
      "template_versions",
      "templates",
      "variants",
      "versions",
      "workspaces",
    ]);
  });

  it("writes and reads a workspace, persona, generation, variant, prototype, and version", async () => {
    const { db } = connection;
    await db.insert(workspaces).values({ id: "pws_aaaaaaaaaaaaaaaa", credentialDigest: "digest", counterDay: "2026-10-16" });
    const priya: PersonaCopy = {
      id: "per_aaaaaaaaaaaaaaaa",
      name: "Priya, payments approver",
      role: "Treasury payments approver",
      organizationType: "Corporate treasury",
      goals: ["Release today's urgent payments before the 3pm cut-off"],
      context: "",
      constraints: ["Four-eyes approval on payments over USD 1m"],
      distinction: null,
    };
    await db.insert(personas).values({ ...priya, workspaceId: "pws_aaaaaaaaaaaaaaaa", goals: [...priya.goals], constraints: [...priya.constraints] });
    await db.insert(generations).values({ id: "gen_aaaaaaaaaaaaaaaa", workspaceId: "pws_aaaaaaaaaaaaaaaa", kind: "generate", intent: "Review and release today's urgent payments", scope: "page", personas: [priya], variantCount: 3, lessons: [] });
    await db.insert(prototypes).values({ id: "pro_aaaaaaaaaaaaaaaa", workspaceId: "pws_aaaaaaaaaaaaaaaa", name: "Exception-first queue", scope: "page", generationId: "gen_aaaaaaaaaaaaaaaa", latestNumber: 1 });
    await db.insert(versions).values({ id: "ver_aaaaaaaaaaaaaaaa", workspaceId: "pws_aaaaaaaaaaaaaaaa", prototypeId: "pro_aaaaaaaaaaaaaaaa", number: 1, generationId: "gen_aaaaaaaaaaaaaaaa", status: "ready", scope: "page", code: "export default function Page() { return null; }", gatesPassed: true });
    await db.insert(variants).values({ id: "var_aaaaaaaaaaaaaaaa", workspaceId: "pws_aaaaaaaaaaaaaaaa", generationId: "gen_aaaaaaaaaaaaaaaa", position: 0, status: "ready", stage: "reviewing", versionId: "ver_aaaaaaaaaaaaaaaa", decision: "kept", direction: { title: "Exception-first queue", sentence: "Payments needing action lead.", axis: "information hierarchy", recipe: null } });

    const [persona] = await db.select().from(personas).where(eq(personas.workspaceId, "pws_aaaaaaaaaaaaaaaa"));
    expect(persona).toMatchObject({ name: "Priya, payments approver", goals: priya.goals, constraints: priya.constraints, example: false });
    const [generation] = await db.select().from(generations);
    expect(generation).toMatchObject({ status: "running", personas: [priya], lessons: [] });
    const [variant] = await db.select().from(variants);
    expect(variant?.direction?.axis).toBe("information hierarchy");
    const [version] = await db.select().from(versions);
    expect(version).toMatchObject({ number: 1, gatesPassed: true, attempts: [], addressedNotes: [] });
    expect(version?.createdAt).toBeInstanceOf(Date);
  });

  it("deletes everything a workspace owns with it", async () => {
    const { db } = connection;
    await db.insert(workspaces).values({ id: "pws_bbbbbbbbbbbbbbbb", credentialDigest: "other", counterDay: "2026-10-16" });
    await db.insert(prototypes).values({ id: "pro_bbbbbbbbbbbbbbbb", workspaceId: "pws_bbbbbbbbbbbbbbbb", name: "Liquidity", scope: "page" });
    await db.insert(versions).values({ id: "ver_bbbbbbbbbbbbbbbb", workspaceId: "pws_bbbbbbbbbbbbbbbb", prototypeId: "pro_bbbbbbbbbbbbbbbb", number: 1, scope: "page" });
    await db.delete(workspaces).where(eq(workspaces.id, "pws_bbbbbbbbbbbbbbbb"));
    expect(await db.select().from(prototypes)).toEqual([]);
    expect(await db.select().from(versions)).toEqual([]);
  });
});

describe("prototypes:migrate", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "fabricate-prototypes-"));
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("creates and migrates the configured PGlite directory", () => {
    const dataDir = path.join(directory, "storage", "prototypes-pglite");
    const output = execFileSync("npx", ["tsx", "src/lib/prototypes/db/migrate-cli.ts"], { env: { ...process.env, FABRICATE_PROTOTYPES_DATABASE: dataDir }, encoding: "utf8" });
    expect(output).toContain(`Migrated PGlite at ${dataDir}`);
    expect(fs.existsSync(path.join(dataDir, "PG_VERSION"))).toBe(true);
  });

  it("carries a template accepted before template versions over as its version 1 (second migration)", async () => {
    const pg = new PGlite();
    const run = async (file: string) => {
      for (const statement of fs.readFileSync(path.join("drizzle-prototypes", file), "utf8").split("--> statement-breakpoint")) if (statement.trim()) await pg.exec(statement);
    };
    try {
      await run("0000_initial.sql");
      await run("0001_version_sample_data.sql");
      const snapshot = { versionId: "ver_aaaaaaaaaaaaaaaa", number: 4, code: "export default function Page() { return null; }", gates: [{ gate: "build", status: "passed", issues: [], warnings: [], durationMs: 3 }], provenance: { saltRelease: "1.73.0", registryRelease: "1.73.0", kitVersion: "2026-10-16.1" } };
      await pg.query(
        `insert into prototypes.templates (id, slug, workspace_id, prototype_id, accepted_by, title, description, brand, tags, snapshot, shell, history, accepted_at) values ('ptp_aaaaaaaaaaaaaaaa', 'queue-aaaaaa', 'pws_aaaaaaaaaaaaaaaa', 'pro_aaaaaaaaaaaaaaaa', 'Maya', 'Queue', 'A queue.', 'payments', '["Payments"]', $1, '{"appName":"Meridian"}', '[{"number":4,"at":"2026-10-16T09:00:00.000Z"}]', '2026-10-16T09:00:00.000Z')`,
        [JSON.stringify(snapshot)],
      );
      await run("0002_template_versions.sql");
      const { rows: [template] } = await pg.query<{ latest_number: number; created_at: Date }>("select latest_number, created_at from prototypes.templates");
      expect(template).toEqual({ latest_number: 1, created_at: new Date("2026-10-16T09:00:00.000Z") });
      const { rows: [version] } = await pg.query<{ id: string; number: number; accepted_by: string; title: string; snapshot: { number: number; sampleData: null }; reproducibility: Record<string, unknown> }>("select id, number, accepted_by, title, snapshot, reproducibility from prototypes.template_versions");
      expect(version).toMatchObject({ number: 1, accepted_by: "Maya", title: "Queue", snapshot: { number: 4, sampleData: null } });
      expect(version!.id).toMatch(/^ptv_[0-9a-f]{16}$/);
      expect(version!.reproducibility).toMatchObject({ saltRelease: "1.73.0", registryRelease: "1.73.0", kitVersion: "2026-10-16.1", checksVersion: 1, checkDigest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    } finally {
      await pg.close();
    }
  });
});
