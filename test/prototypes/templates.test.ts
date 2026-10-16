import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { ValidationError } from "@/lib/db/errors";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { generations, personas, prototypes, templateRechecks, templateVersions, variants, versions, workspaces } from "@/lib/prototypes/db/schema";
import { TemplateBrokenError, forkVersion, startFromTemplate } from "@/lib/prototypes/fork";
import { CHECKS_VERSION, checkDigest } from "@/lib/prototypes/gates";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { versionsOf } from "@/lib/prototypes/prototypes";
import { ANONYMOUS, type Acceptance, acceptVersion, eligibility, liveTemplates, previewPng, templateBySlug, validateAcceptance, withdrawTemplate } from "@/lib/prototypes/templates";
import { keepVariant } from "@/lib/prototypes/variants";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// prototypes/versions spec: forking, accepting immutable template versions, using, and withdrawing templates.

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const AUDITED = { violations: [], at: "2026-10-16T09:00:00.000Z" };

describe("templates from prototypes", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  const original = getConfig();
  const details: Acceptance = { title: "Urgent payments queue", description: "Payments that need action lead.", brand: "payments", tags: ["Payments"], displayName: null };

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

  /** A kept page prototype at version 1, audited with no violations. */
  async function kept(): Promise<{ prototypeId: string; versionId: string }> {
    const [approver] = await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt);
    const generationId = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments before cut-off", scope: "page", personaIds: [approver!.id], variants: 1 });
    await orchestrateGeneration(generationId);
    const [variant] = await connection.db.select().from(variants).where(eq(variants.generationId, generationId));
    const { prototypeId } = await keepVariant(connection.db, workspaceId, variant!.id, "");
    await connection.db.update(versions).set({ audit: AUDITED }).where(eq(versions.prototypeId, prototypeId));
    return { prototypeId, versionId: variant!.versionId! };
  }

  it("validates the details: a title, one or two sentences, a brand, and tags", () => {
    expect(validateAcceptance({ title: " Urgent  queue ", description: "One. Two.", brand: "markets", tags: "Payments, approvals, Payments", displayName: "" })).toEqual({ title: "Urgent queue", description: "One. Two.", brand: "markets", tags: ["Payments", "approvals"], displayName: null });
    const issues = (() => {
      try {
        validateAcceptance({ title: "", description: "One. Two. Three.", brand: "retail", tags: "", displayName: "" });
      } catch (error) {
        return (error as ValidationError).issues.map((issue) => issue.field);
      }
      return [];
    })();
    expect(issues).toEqual(["title", "description", "brand", "tags"]);
  });

  it("is eligible only for a passing, audited page with no serious or critical violation (Not eligible; Component scope)", () => {
    const base = { scope: "page" as const, status: "ready" as const, gatesPassed: true, audit: AUDITED, renderError: null };
    expect(eligibility(base)).toEqual({ eligible: true });
    expect(eligibility({ ...base, scope: "component" }).eligible).toBe(false);
    expect(eligibility({ ...base, audit: null })).toMatchObject({ eligible: false, reason: expect.stringContaining("hasn't run") });
    const serious = { rule: "color-contrast", impact: "serious" as const, description: "", help: "Elements must meet minimum color contrast ratio thresholds", targets: [], html: [] };
    expect(eligibility({ ...base, audit: { ...AUDITED, violations: [{ ...serious, impact: "moderate" }] } }).eligible).toBe(true);
    expect(eligibility({ ...base, audit: { ...AUDITED, violations: [serious] } })).toEqual({ eligible: false, reason: "It has a serious accessibility violation: Elements must meet minimum color contrast ratio thresholds (color-contrast)." });
  });

  it("publishes template version 1 with a copy of the version and what it was checked against, as an anonymous visitor, and refuses an ineligible one (Accepting; Reproducibility inputs)", async () => {
    const { prototypeId, versionId } = await kept();
    const { template, version } = await acceptVersion(connection.db, workspaceId, versionId, details, PNG);
    expect(template).toMatchObject({ prototypeId, latestNumber: 1 });
    expect(template.slug).toMatch(/^urgent-payments-queue-[a-z0-9]{6}$/);
    expect(version).toMatchObject({ templateId: template.id, number: 1, acceptedBy: ANONYMOUS, brand: "payments", previewPng: PNG });
    expect(version.snapshot).toMatchObject({ versionId, number: 1, prototypeName: "Exception-first queue", personas: [{ name: "Maya Lindqvist" }] });
    expect(version.snapshot.sampleData?.source).toContain("payments");
    expect(version.shell.appName).toBe("Meridian Corporate Banking");
    expect(version.reproducibility).toEqual({ saltRelease: "1.73.0", registryRelease: expect.stringMatching(/^1\.73\.0/), kitVersion: expect.any(String), checksVersion: CHECKS_VERSION, checkDigest: checkDigest(version.snapshot.gates) });
    expect(version.reproducibility.checkDigest).toMatch(/^[0-9a-f]{64}$/);

    await connection.db.update(versions).set({ audit: null }).where(eq(versions.id, versionId));
    await expect(acceptVersion(connection.db, workspaceId, versionId, details, null)).rejects.toThrow(PrototypesLimitError);
  });

  it("digests the same gate results the same way, whatever their timings and order", () => {
    const gates = [
      { gate: "typecheck" as const, status: "passed" as const, issues: [], warnings: [], durationMs: 812 },
      { gate: "salt-usage" as const, status: "passed" as const, issues: [], warnings: [{ code: "lab", message: "Tokenized input is in lab." }, { code: "deprecated", message: "variant is deprecated." }], durationMs: 40 },
    ];
    const reordered = [{ ...gates[1]!, durationMs: 3, warnings: [...gates[1]!.warnings].reverse() }, { ...gates[0]!, durationMs: 1_400 }];
    expect(checkDigest(reordered)).toBe(checkDigest(gates));
    expect(checkDigest([gates[0]!])).not.toBe(checkDigest(gates));
  });

  it("publishes the next template version for a later version, leaving version 1 unchanged, and remembers the display name (Accepting a later version)", async () => {
    const { prototypeId, versionId } = await kept();
    const first = await acceptVersion(connection.db, workspaceId, versionId, details, null, new Date("2026-10-16T09:00:00.000Z"));
    // A second version, as a refinement would make it.
    const [base] = await connection.db.select().from(versions).where(eq(versions.id, versionId));
    await connection.db.insert(versions).values({ ...base!, id: "ver_bbbbbbbbbbbbbbbb", number: 2, code: `${base!.code}\n// v2` });
    const second = await acceptVersion(connection.db, workspaceId, "ver_bbbbbbbbbbbbbbbb", { ...details, displayName: "Maya's team" }, null, new Date("2026-10-16T10:00:00.000Z"));
    expect(second.template.id).toBe(first.template.id);
    expect(second.version).toMatchObject({ number: 2, acceptedBy: "Maya's team", snapshot: { number: 2 } });
    const [workspace] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(workspace!.displayName).toBe("Maya's team");

    const [live] = await liveTemplates(connection.db);
    expect(live).toMatchObject({ prototypeId, latestNumber: 2, latest: { number: 2 } });
    expect(live!.versions.map((version) => version.number)).toEqual([2, 1]);
    const [stored] = await connection.db.select().from(templateVersions).where(eq(templateVersions.id, first.version.id));
    expect(stored).toEqual(first.version);
  });

  it("withdraws every version of a template, only for the workspace that accepted it (Withdrawing)", async () => {
    const { versionId } = await kept();
    const { template } = await acceptVersion(connection.db, workspaceId, versionId, details, null);
    const other = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
    await expect(withdrawTemplate(connection.db, other, template.id)).rejects.toThrow("Unknown template");
    await withdrawTemplate(connection.db, workspaceId, template.id);
    expect(await liveTemplates(connection.db)).toEqual([]);
    expect(await templateBySlug(connection.db, template.slug)).toBeNull();
  });

  it("starts a prototype from the latest template version without a model call, recording that version, and refuses while it is Broken (Using template version 2)", async () => {
    const { versionId } = await kept();
    await acceptVersion(connection.db, workspaceId, versionId, details, null);
    const { template, version } = await acceptVersion(connection.db, workspaceId, versionId, details, null);
    const visitor = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
    const before = await connection.db.select().from(generations);
    const started = await startFromTemplate(connection.db, visitor, template.id);
    const [copy] = await versionsOf(connection.db, started);
    expect(copy!.provenance?.startedFromTemplate).toEqual({ templateId: template.id, title: "Urgent payments queue", templateVersion: 2 });
    expect(copy!.sampleData).toEqual(version.snapshot.sampleData);
    expect(await connection.db.select().from(generations)).toHaveLength(before.length);

    await connection.db.insert(templateRechecks).values({ id: "rck_aaaaaaaaaaaaaaaa", templateVersionId: version.id, runtimeHash: "next", saltRelease: "1.74.0", status: "broken", gates: [], finishedAt: new Date() });
    await expect(startFromTemplate(connection.db, visitor, template.id)).rejects.toThrow(TemplateBrokenError);
  });

  it("forks a version without a model call into a new prototype, leaving the original unchanged (Forking version 3)", async () => {
    const { prototypeId, versionId } = await kept();
    const before = await connection.db.select().from(generations);
    const forkId = await forkVersion(connection.db, workspaceId, versionId);
    const [fork] = await connection.db.select().from(prototypes).where(eq(prototypes.id, forkId));
    expect(fork!.name).toBe("Exception-first queue (fork)");
    const [copy] = await versionsOf(connection.db, forkId);
    const [source] = await versionsOf(connection.db, prototypeId);
    expect(copy).toMatchObject({ number: 1, code: source!.code, compiled: source!.compiled, scope: "page", gatesPassed: true });
    expect(copy!.provenance?.forkedFrom).toEqual({ prototypeId, prototypeName: "Exception-first queue", versionId, number: 1 });
    expect(copy!.provenance?.direction).toEqual(source!.provenance?.direction);
    expect(await versionsOf(connection.db, prototypeId)).toHaveLength(1);
    // Nothing was generated: every model call belongs to a generation.
    expect(await connection.db.select().from(generations)).toHaveLength(before.length);
  });

  it("stores a captured image only when it is a PNG", () => {
    expect(previewPng(`data:image/png;base64,${PNG.toString("base64")}`)).toEqual(PNG);
    expect(previewPng(`data:image/png;base64,${Buffer.from("not a png").toString("base64")}`)).toBeNull();
    expect(previewPng("data:image/jpeg;base64,AAAA")).toBeNull();
  });
});
