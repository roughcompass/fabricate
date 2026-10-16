import { generateText, Output } from "ai";
import ts from "typescript";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type PrototypesSettings, getConfig } from "@/lib/config";
import type { PrototypesExecutor } from "../db/client";
import { generations, variants } from "../db/schema";
import { saltOnlyGate, typecheckGate } from "../gates";
import { gatewayOptions, modelFor } from "../models";
import { workspaceShell } from "../shell";
import { templateVersionSnapshot } from "../templates";
import { AXES, type Direction, type SampleData } from "../types";
import { VariantFailure, failureFrom } from "./errors";
import { planPrompt } from "./prompts";

/**
 * The plan step (generation spec, "Variants take distinct design directions"
 * and "Variants of a generation share one sample data set"): one direction
 * per variant, each varying a different axis, and one fictional data module
 * every variant imports. The data module must pass the Salt-only and
 * typecheck gates on its own, since every variant compiles with it.
 */

const PLAN_TIMEOUT_MS = 120_000;

function planSchema(count: number) {
  return z.object({
    directions: z
      .array(z.object({ title: z.string().min(3).max(60), sentence: z.string().min(10).max(220), axis: z.enum(AXES), recipe: z.string().max(60).nullable() }))
      .length(count),
    sampleData: z.object({ description: z.string().min(3).max(220), source: z.string().min(20).max(20_000) }),
  });
}

/** Why a plan isn't usable, or null when it is. */
export function planProblems(directions: readonly Direction[], data: SampleData): string[] {
  const problems: string[] = [];
  const titles = directions.map((direction) => direction.title.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) problems.push("Two directions have the same title; every direction must differ.");
  // Every axis is used before any repeats, so up to four directions each vary a different axis, and six or eight spread evenly.
  const perAxis = AXES.map((axis) => directions.filter((direction) => direction.axis === axis).length);
  if (Math.max(...perAxis) > Math.ceil(directions.length / AXES.length) || perAxis.filter(Boolean).length < Math.min(directions.length, AXES.length)) {
    problems.push(directions.length <= AXES.length ? "Two directions vary the same axis; give each direction a different axis." : "The directions don't spread across the axes; use every axis before any axis repeats.");
  }
  const probe = { code: "export default function DataCheck() {\n  return null;\n}\n", data: data.source };
  for (const result of [saltOnlyGate(probe), typecheckGate(probe)]) {
    for (const issue of result.issues) problems.push(`The sample data failed the ${result.gate} check: ${issue.message}`);
  }
  return problems;
}

/** The names a data module exports, from its syntax alone. */
export function exportedNames(source: string): string[] {
  const file = ts.createSourceFile("data.ts", source, ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS);
  const names = new Set<string>();
  for (const statement of file.statements) {
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(statement) && exported) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isFunctionDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isClassDeclaration(statement)) && exported && statement.name) names.add(statement.name.text);
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements) names.add(element.name.text);
  }
  return [...names].sort();
}

/** Why new data doesn't keep the template's shape: the exports it lacks. The template may still render it, so this asks for a better plan but never fails one. */
export function dataShapeProblems(templateData: string, data: string): string[] {
  const have = new Set(exportedNames(data));
  const missing = exportedNames(templateData).filter((name) => !have.has(name));
  return missing.length ? [`The sample data doesn't keep the template's shape: it doesn't export ${missing.join(", ")}.`] : [];
}

/** Plans the generation once; on a retry it finds the plan already stored. */
export async function planGeneration(db: PrototypesExecutor, generationId: string, settings: PrototypesSettings = getConfig().prototypes): Promise<void> {
  const [generation] = await db.select().from(generations).where(eq(generations.id, generationId));
  if (!generation) throw new Error(`Unknown generation ${generationId}`);
  if (generation.directions && generation.sampleData) return;
  const shell = await workspaceShell(db, generation.workspaceId);
  const { model } = modelFor("plan", settings);
  // With a template attached, it is variant 0, so the plan has one direction fewer and data in the template's shape.
  const snapshot = generation.template ? await templateVersionSnapshot(db, generation.template.templateVersionId) : null;
  if (generation.template && !snapshot) throw new VariantFailure({ kind: "internal", message: `The template ${generation.template.title} v${generation.template.templateVersion} is no longer available.` });
  const templateData = snapshot?.sampleData ?? null;
  const count = generation.variantCount - (generation.template ? 1 : 0);
  const base = planPrompt({
    intent: generation.intent,
    scope: generation.scope,
    personas: generation.personas,
    variants: count,
    shell,
    lessons: generation.lessons,
    template: generation.template && templateData ? { title: generation.template.title, data: templateData } : null,
  });
  let problems: string[] = [];
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = problems.length ? `${base}\n\nYour previous plan wasn't usable:\n${problems.map((problem) => `- ${problem}`).join("\n")}` : base;
      const { output } = await generateText({ model, output: Output.object({ schema: planSchema(count) }), prompt, providerOptions: gatewayOptions(settings), timeout: PLAN_TIMEOUT_MS });
      problems = planProblems(output.directions, output.sampleData);
      const shape = templateData ? dataShapeProblems(templateData.source, output.sampleData.source) : [];
      // A shape that still doesn't fit after the second try is accepted: variant 0 then shows the template's own data.
      if (problems.length === 0 && (shape.length === 0 || attempt === 2)) {
        await db.transaction(async (tx) => {
          await tx.update(generations).set({ directions: output.directions, sampleData: output.sampleData }).where(eq(generations.id, generationId));
          const rows = await tx.select({ id: variants.id, position: variants.position }).from(variants).where(eq(variants.generationId, generationId));
          for (const row of rows) {
            const direction = generation.template ? (row.position === 0 ? null : output.directions[row.position - 1]) : output.directions[row.position];
            await tx.update(variants).set({ direction: direction ?? null, stage: "writing", updatedAt: new Date() }).where(eq(variants.id, row.id));
          }
        });
        return;
      }
      problems = [...problems, ...shape];
    }
  } catch (error) {
    throw new VariantFailure(failureFrom(error));
  }
  throw new VariantFailure({ kind: "internal", message: `The plan wasn't usable after a second try: ${problems.join(" ")}` });
}

/** Ends every variant of a generation whose plan failed. */
export async function failPlan(db: PrototypesExecutor, generationId: string, failure: VariantFailure["failure"], now = new Date()): Promise<void> {
  await db.update(variants).set({ status: "failed", failure, updatedAt: now }).where(eq(variants.generationId, generationId));
  await db.update(generations).set({ status: "failed", error: failure, finishedAt: now }).where(eq(generations.id, generationId));
}
