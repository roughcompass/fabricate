"use server";

import { notFound, redirect } from "next/navigation";
import type { FormState } from "@/components/ui/form";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { requirePrototypes, templatesAvailable } from "@/lib/prototypes/guard";
import { PrototypesLimitError } from "@/lib/prototypes/limits";
import { prototypesRequest } from "@/lib/prototypes/request";
import { type AcceptanceInput, acceptVersion, previewPng, validateAcceptance, withdrawTemplate } from "@/lib/prototypes/templates";
import { getDb } from "@/lib/db/client";
import { candidateRun, confirmable, conformanceOf, startConformance } from "@/lib/prototypes/conformance";
import { getPrototype } from "@/lib/prototypes/prototypes";
import { liveTemplateFor } from "@/lib/prototypes/templates";
import { errorsFrom, text } from "@/lib/web/form-data";

export type AcceptState = FormState<AcceptanceInput> & {
  stage: "details" | "confirm";
  submission?: number;
  /** The Salt Patterns Run checking the version, or null when none was started because no Release is selected. */
  run?: string | null;
};

/**
 * Accepting a version as a template, in two steps (versions spec, "A page
 * version can be accepted as a template"): the details, then a confirmation
 * that summarizes the version's evidence and carries the preview image the
 * frame captured. Continuing to the confirmation starts the version's check
 * against the Salt Patterns initiative's Releases (template-conformance
 * spec), and confirming verifies its result again here.
 */
export async function acceptAction(prototypeId: string, versionId: string, number: number, previous: AcceptState, formData: FormData): Promise<AcceptState> {
  requirePrototypes();
  if (!templatesAvailable()) notFound();
  if (!isPublicId(prototypeId, "pro") || !isPublicId(versionId, "ver")) throw new NotFoundError("Unknown version");
  const values: AcceptanceInput = {
    title: text(formData, "title", 400),
    description: text(formData, "description", 2_000),
    brand: text(formData, "brand", 40),
    tags: text(formData, "tags", 1_000),
    displayName: text(formData, "displayName", 400),
  };
  const submission = (previous.submission ?? 0) + 1;
  let acceptance;
  try {
    acceptance = validateAcceptance(values);
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error), stage: "details", submission };
    throw error;
  }
  const { db, workspace } = await prototypesRequest();
  if (text(formData, "stage", 10) !== "confirm") {
    // Going back and continuing again keeps the version's check unless it failed.
    const earlier = previous.run ? candidateRun(getDb(), previous.run, versionId) : null;
    const kept = earlier && earlier.state !== "failed" && earlier.state !== "canceled" ? earlier.publicId : null;
    return { values, errors: {}, stage: "confirm", submission, run: kept ?? (await startCheck(db, workspace.id, prototypeId, versionId)) };
  }
  const run = text(formData, "run", 40) || null;
  const conformance = conformanceOf(getDb(), run, versionId);
  if (!confirmable(conformance)) {
    return { values, errors: { base: ["This version doesn't meet the Releases selected on Salt Patterns yet, so it can't be accepted."] }, stage: "confirm", submission: previous.submission, run };
  }
  try {
    const standards = conformance.status === "evaluated" ? ({ status: "evaluated", assessmentId: conformance.assessmentId, evaluationId: conformance.evaluationId } as const) : ({ status: "not_evaluated", reason: "no_release" } as const);
    await acceptVersion(db, workspace.id, versionId, acceptance, previewPng(String(formData.get("preview") ?? "")), new Date(), standards);
  } catch (error) {
    if (error instanceof PrototypesLimitError) return { values, errors: { base: [error.message] }, stage: "details", submission };
    throw error;
  }
  redirect(`/prototypes/${prototypeId}?${new URLSearchParams({ v: String(number), notice: "accepted" })}`);
}

async function startCheck(db: Awaited<ReturnType<typeof prototypesRequest>>["db"], workspaceId: string, prototypeId: string, versionId: string): Promise<string | null> {
  const prototype = await getPrototype(db, workspaceId, prototypeId);
  const template = await liveTemplateFor(db, prototypeId);
  return startConformance(getDb(), { prototypeId, name: prototype.name, versionId, templateId: template?.id ?? null });
}

/** Checks the version again with a new Run, after a failure or while the worker wasn't running; returns the Run's id. */
export async function recheckAction(prototypeId: string, versionId: string): Promise<string | null> {
  requirePrototypes();
  if (!templatesAvailable()) notFound();
  if (!isPublicId(prototypeId, "pro") || !isPublicId(versionId, "ver")) throw new NotFoundError("Unknown version");
  const { db, workspace } = await prototypesRequest();
  return startCheck(db, workspace.id, prototypeId, versionId);
}

/** Withdraws the template accepted from a prototype, after confirmation. */
export async function withdrawAction(formData: FormData): Promise<void> {
  requirePrototypes();
  const prototypeId = text(formData, "prototype", 40);
  const templateId = text(formData, "template", 40);
  if (!isPublicId(prototypeId, "pro") || !isPublicId(templateId, "ptp")) throw new NotFoundError("Unknown template");
  const { db, workspace } = await prototypesRequest();
  await withdrawTemplate(db, workspace.id, templateId);
  redirect(`/prototypes/${prototypeId}?notice=withdrawn`);
}
