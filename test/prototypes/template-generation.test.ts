import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig, loadConfig, setConfig, withOverrides } from "@/lib/config";
import { ValidationError } from "@/lib/db/errors";
import { newWorkspaceKey } from "@/lib/demo/workspace-key";
import { type PrototypesConnection, setPrototypesDb } from "@/lib/prototypes/db/client";
import { generations, personas, variants, versions, workspaces } from "@/lib/prototypes/db/schema";
import { MOCK_DATA } from "@/lib/prototypes/models/mock-fixtures";
import { dataShapeProblems, exportedNames } from "@/lib/prototypes/pipeline/plan";
import { startGeneration } from "@/lib/prototypes/pipeline/start";
import { acceptVersion } from "@/lib/prototypes/templates";
import { keepVariant, variantTitle } from "@/lib/prototypes/variants";
import { ensurePrototypesWorkspace } from "@/lib/prototypes/workspace";
import { orchestrateGeneration } from "@/workflows/prototypes/orchestrate";
import { createPrototypesTestDb } from "../support/prototypes-db";

// generation spec: "A generation can start from a template" and "Shared sample data takes the attached template's shape" (design decision 8 of converge-templates-and-prototypes).

const INTENT = "Release today's urgent payments before cut-off";
const OWN_DATA = `export interface Approval {\n  readonly id: string;\n  readonly payee: string;\n}\n\nexport const approvals: readonly Approval[] = [{ id: "A-1", payee: "Northwind Supplies" }];\n`;
const OWN_CODE = `import { StackLayout, Text } from "@salt-ds/core";\nimport { approvals } from "./data";\n\nexport default function Approvals() {\n  return (\n    <StackLayout gap={1}>\n      {approvals.map((approval) => (\n        <Text key={approval.id}>{approval.payee}</Text>\n      ))}\n    </StackLayout>\n  );\n}\n`;

describe("generating from a template", () => {
  let connection: PrototypesConnection;
  let workspaceId: string;
  let personaId: string;
  const original = getConfig();

  beforeEach(async () => {
    setConfig(withOverrides(loadConfig({ environment: "test" }), { prototypes: { models: { generate: "mock", plan: "mock", review: "mock", learn: "mock" } } }));
    connection = await createPrototypesTestDb();
    await setPrototypesDb(connection);
    workspaceId = (await ensurePrototypesWorkspace(connection.db, newWorkspaceKey())).id;
    personaId = (await connection.db.select().from(personas).where(eq(personas.workspaceId, workspaceId)).orderBy(personas.createdAt))[0]!.id;
  });

  afterEach(async () => {
    await setPrototypesDb(undefined);
    setConfig(original);
  });

  /** A template accepted from a kept page, optionally with other code and data. */
  async function template(own?: { code: string; data: string }) {
    const generationId = await startGeneration(connection.db, workspaceId, { intent: "Review and release today's urgent payments", scope: "page", personaIds: [personaId], variants: 1 });
    await orchestrateGeneration(generationId);
    const [variant] = await connection.db.select().from(variants).where(eq(variants.generationId, generationId));
    await keepVariant(connection.db, workspaceId, variant!.id, "");
    const set = { audit: { violations: [], at: "2026-10-16T09:00:00.000Z" }, ...(own && { code: own.code, sampleData: { description: "One approval.", source: own.data } }) };
    await connection.db.update(versions).set(set).where(eq(versions.id, variant!.versionId!));
    return (await acceptVersion(connection.db, workspaceId, variant!.versionId!, { title: "Urgent payments queue", description: "Payments that need action lead.", brand: "payments", tags: ["Payments"], displayName: null }, null)).template;
  }

  async function generateFrom(templateId: string, count: number) {
    const generationId = await startGeneration(connection.db, workspaceId, { intent: INTENT, scope: "page", personaIds: [personaId], variants: count, templateId });
    await orchestrateGeneration(generationId);
    const [generation] = await connection.db.select().from(generations).where(eq(generations.id, generationId));
    const rows = await connection.db.select({ variant: variants, version: versions }).from(variants).innerJoin(versions, eq(versions.id, variants.versionId)).where(eq(variants.generationId, generationId)).orderBy(asc(variants.position));
    return { generation: generation!, rows };
  }

  it("shows the template, unchanged, as variant 0 beside new directions that share data in its shape (Three variants from a template)", async () => {
    const accepted = await template();
    const [snapshot] = await connection.db.select().from(versions).where(eq(versions.id, (await connection.db.select().from(variants))[0]!.versionId!));
    const [before] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));

    const { generation, rows } = await generateFrom(accepted.id, 3);

    expect(generation.template).toEqual({ templateId: accepted.id, templateVersionId: expect.stringMatching(/^ptv_/), templateVersion: 1, title: "Urgent payments queue", hero: null });
    expect(generation.directions).toHaveLength(2);
    expect(rows.map(({ variant }) => variant.status)).toEqual(["ready", "ready", "ready"]);
    const [zero, ...others] = rows;
    expect(zero!.variant.direction).toBeNull();
    expect(variantTitle(generation, zero!.variant)).toBe("Urgent payments queue (template)");
    expect(zero!.version).toMatchObject({ code: snapshot!.code, gatesPassed: true });
    expect(zero!.version.provenance).toMatchObject({ model: "none: the template, unchanged", dataNote: null });
    expect(zero!.version.attempts).toHaveLength(1);
    expect(others.map(({ variant }) => variant.direction?.title)).toEqual(generation.directions!.map((direction) => direction.title));
    // Same data across the template and the new directions.
    for (const { version } of rows) expect(version.sampleData).toEqual(generation.sampleData);
    for (const { version } of rows) expect(version.provenance?.startedFromTemplate).toEqual({ templateId: accepted.id, title: "Urgent payments queue", templateVersion: 1 });
    // Variant 0 calls no model, so only the two new directions count toward today's generations.
    const [after] = await connection.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(after!.variantsToday - before!.variantsToday).toBe(2);
  });

  it("shows the template with its own data, and says so, when the generation's data doesn't fit it (Data doesn't fit the template)", async () => {
    const accepted = await template({ code: OWN_CODE, data: OWN_DATA });

    const { generation, rows } = await generateFrom(accepted.id, 2);

    const [zero, other] = rows;
    expect(zero!.variant.status).toBe("ready");
    expect(zero!.version.sampleData).toEqual({ description: "One approval.", source: OWN_DATA });
    expect(zero!.version.provenance?.dataNote).toMatch(/doesn't fit the template \(it fails the typecheck check\), so variant 0 shows the template with its own data/);
    expect(zero!.version.attempts[0]!.passed).toBe(true);
    // The other variants keep the generation's data.
    expect(generation.sampleData?.source).toBe(MOCK_DATA);
    expect(other!.version.sampleData).toEqual(generation.sampleData);
    expect(other!.version.provenance?.dataNote ?? null).toBeNull();
  });

  it("keeps variant 0 under the template's name", async () => {
    const accepted = await template();
    const { rows } = await generateFrom(accepted.id, 2);
    const { prototypeId } = await keepVariant(connection.db, workspaceId, rows[0]!.variant.id, "");
    expect(prototypeId).toMatch(/^pro_/);
    const [version] = await connection.db.select().from(versions).where(eq(versions.id, rows[0]!.version.id));
    expect(version!.provenance?.startedFromTemplate?.templateVersion).toBe(1);
  });

  it("refuses one variant, a component, or a template that's gone", async () => {
    const accepted = await template();
    const refused = async (input: Partial<Parameters<typeof startGeneration>[2]>) => {
      try {
        await startGeneration(connection.db, workspaceId, { intent: INTENT, scope: "page", personaIds: [personaId], variants: 3, templateId: accepted.id, ...input });
      } catch (error) {
        return (error as ValidationError).issues.map((issue) => issue.field);
      }
      throw new Error("Expected a refusal");
    };
    expect(await refused({ variants: 1 })).toEqual(["variants"]);
    expect(await refused({ scope: "component" })).toEqual(["scope"]);
    expect(await refused({ templateId: "ptp_gone000000000000" })).toEqual(["template"]);
  });

  it("compares data modules by the names they export", () => {
    expect(exportedNames(OWN_DATA)).toEqual(["Approval", "approvals"]);
    expect(dataShapeProblems(OWN_DATA, OWN_DATA)).toEqual([]);
    expect(dataShapeProblems(OWN_DATA, MOCK_DATA)).toEqual([expect.stringMatching(/doesn't export Approval, approvals/)]);
  });
});
