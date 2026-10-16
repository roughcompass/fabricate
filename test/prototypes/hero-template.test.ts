import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import type { Db } from "@/lib/db/client";
import { HERO_SLUGS, templateBySlug } from "@/lib/demo/catalog";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative, updateReleaseSelections } from "@/lib/initiatives/initiative-records";
import { jobHandlers } from "@/lib/jobs/registry";
import { drainJobs } from "@/lib/jobs/worker";
import { heroStanding } from "@/lib/prototypes/conformance";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { generations, personas, variants, versions } from "@/lib/prototypes/db/schema";
import { stableVersion } from "@/lib/prototypes/heroes/generate";
import { heroFiles, heroSnapshot, heroTemplate, startFromHero } from "@/lib/prototypes/heroes/use";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { versionsOf } from "@/lib/prototypes/prototypes";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { publishDraft } from "@/lib/standards/publish";
import { createStandard } from "@/lib/standards/standard-records";
import { STARTERS } from "@/lib/standards/starters";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createTestDb } from "../support/db";
import { createPrototypesTestDb } from "../support/prototypes-db";

// template-gallery spec, "Using a hero template"; portal-runtime spec, "Each hero's conformant composition meets the selected Standards".

describe("hero templates", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" } } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  it("has a committed page for every hero, which compiles and passes the gates with @deweb/portal allowed", async () => {
    for (const slug of HERO_SLUGS) {
      const hero = heroTemplate(slug);
      expect(hero, slug).not.toBeNull();
      const snapshot = await heroSnapshot(slug);
      expect(snapshot, slug).not.toBeNull();
      expect(snapshot!.gates.every((result) => result.status === "passed"), slug).toBe(true);
      expect(snapshot!.provenance.hero).toBe(slug);
    }
  });

  it("composes each committed page from the catalog's main route, each region at its conformant version", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/demo/runtime/generated/manifest.json"), "utf8")) as { heroes: { slug: string; page: { route: string; regions: unknown[] } }[] };
    for (const slug of HERO_SLUGS) {
      const app = templateBySlug(slug)!.app;
      const route = app.routes[0]!;
      const page = manifest.heroes.find((hero) => hero.slug === slug)!.page;
      expect(page.route, slug).toBe(route.path);
      expect(page.regions, slug).toEqual(route.regions.map(({ member, area }) => ({ member, version: stableVersion(app.members.find((entry) => entry.id === member)!).version, area })));
    }
  });

  it("starts a page-scope prototype from the Payments hero, marked as started from it, with no model call (Using a hero template)", async () => {
    const before = await connection.db.select().from(generations);
    const prototypeId = await startFromHero(connection.db, workspaceId, "payments-workspace");
    const [version] = await versionsOf(connection.db, prototypeId);
    expect(version).toMatchObject({ number: 1, scope: "page", status: "ready", gatesPassed: true, code: heroTemplate("payments-workspace")!.code });
    expect(version!.provenance).toMatchObject({ hero: "payments-workspace", startedFromTemplate: { templateId: "hero:payments-workspace", title: "Payments workspace", templateVersion: "3.2.0" } });
    expect(await connection.db.select().from(generations)).toHaveLength(before.length);
  });

  it("attaches a hero as variant 0, which keeps the hero's lineage", async () => {
    const [approver] = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt);
    const generationId = await startGeneration(connection.db, workspaceId, { intent: "Release today's urgent payments before cut-off", scope: "page", personaIds: [approver!.id], variants: 2, templateId: "hero:payments-workspace" });
    await orchestrateGeneration(generationId);
    const [generation] = await connection.db.select().from(generations).where(eq(generations.id, generationId));
    expect(generation!.template).toMatchObject({ templateId: "hero:payments-workspace", templateVersion: "3.2.0", hero: "payments-workspace" });
    const [zero] = await connection.db.select({ variant: variants, version: versions }).from(variants).innerJoin(versions, eq(versions.id, variants.versionId)).where(eq(variants.generationId, generationId)).orderBy(asc(variants.position));
    expect(zero!.version).toMatchObject({ status: "ready", code: heroTemplate("payments-workspace")!.code });
    expect(zero!.version.provenance).toMatchObject({ hero: "payments-workspace" });
  });

  describe("Standards", () => {
    let db: Db;
    beforeEach(() => {
      db = createTestDb();
    });

    it("is Not evaluated with no Release selected", async () => {
      const hero = heroTemplate("payments-workspace")!;
      expect(await heroStanding(db, hero, heroFiles(hero))).toMatchObject({ status: "not_evaluated", reason: "No Release is selected on Salt Patterns." });
    });

    it("meets both Salt starters for every hero's page, once its Run is evaluated (The conformant composition meets the Standards)", async () => {
      const releases = STARTERS.map((starter) => {
        const { standard, draft } = createStandard(db, { name: starter.name, purpose: starter.purpose }, starter.document);
        return publishDraft(db, standard.publicId, draft.lockVersion).publicId;
      });
      updateReleaseSelections(db, SALT_PATTERNS_INITIATIVE_ID, saltPatternsInitiative(db).lockVersion, releases);
      for (const slug of HERO_SLUGS) {
        const hero = heroTemplate(slug)!;
        expect(await heroStanding(db, hero, heroFiles(hero))).toMatchObject({ status: "not_evaluated", reason: "Its Evaluation is running." });
        await drainJobs(db, jobHandlers(db));
        const standing = await heroStanding(db, hero, heroFiles(hero));
        const gaps = standing.releases.filter((release) => release.counts.gap > 0 || release.counts.indeterminate > 0);
        expect({ slug, status: standing.status, gaps }).toEqual({ slug, status: "meets", gaps: [] });
      }
    });
  });
});
