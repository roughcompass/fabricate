"use server";

import { parseCanonical } from "@repo-facts/contract";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { StaleRecordError, ValidationError } from "@/lib/db/errors";
import { requirePublicId } from "@/lib/db/ids";
import { publishDraft, reviseRelease } from "@/lib/standards/publish";
import * as records from "@/lib/standards/standard-records";
import { findStarter } from "@/lib/standards/starters";
import { validateStandard } from "@/lib/standards/validate";
import { lockVersion, submitForm } from "@/lib/web/actions";
import { integer, text } from "@/lib/web/form-data";
import type { DraftSaveState, StandardFormState, StandardFormValues } from "./form-state";
import { routes } from "@/lib/web/routes";

/** The largest draft document a save accepts, in characters. */
const MAX_DRAFT_LENGTH = 512 * 1024;

function readMetadata(formData: FormData): StandardFormValues {
  return { name: text(formData, "name", 500), purpose: text(formData, "purpose", 4_000) };
}

const assertStandardId = (publicId: string) => requirePublicId(publicId, "std", "Standard");

export async function createStandard(_previous: StandardFormState, formData: FormData): Promise<StandardFormState> {
  const values = readMetadata(formData);
  // A starter supplies the draft; an unknown starter id starts blank rather than guessing.
  const starter = findStarter(text(formData, "starter", 100));
  return submitForm(values, () => routes.standardDraft(records.createStandard(getDb(), values, starter?.document).standard.publicId, { notice: "created" }));
}

export async function updateStandard(standardId: string, _previous: StandardFormState, formData: FormData): Promise<StandardFormState> {
  assertStandardId(standardId);
  const values = readMetadata(formData);
  return submitForm(
    values,
    () => {
      records.updateStandardMetadata(getDb(), standardId, lockVersion(formData), values);
      return routes.standard(standardId, { notice: "updated" });
    },
    "This Standard was changed by someone else. Reload it and try again.",
  );
}

/**
 * Saves the editor's structured draft and returns the complete validation
 * result. A draft may be saved while it is still invalid; publication refuses
 * it. The document is parsed as data into null-prototype objects and never
 * evaluated.
 */
export async function saveDraft(standardId: string, previous: DraftSaveState, formData: FormData): Promise<DraftSaveState> {
  assertStandardId(standardId);
  const submission = previous.submission + 1;
  const lockVersion = integer(formData, "lockVersion");
  const raw = formData.get("document");
  if (lockVersion === null || typeof raw !== "string" || raw.length > MAX_DRAFT_LENGTH) {
    return { ...previous, status: "rejected", message: "The draft could not be saved because it is missing or too large.", submission };
  }
  let document;
  try {
    document = parseCanonical(raw);
  } catch {
    return { ...previous, status: "rejected", message: "The draft could not be read as a structured document.", submission };
  }

  const db = getDb();
  const standard = records.getStandard(db, standardId);
  const draft = records.draftOf(db, standard.id);
  if (!draft) redirect(routes.standard(standardId, { notice: "no_draft" }));
  try {
    const saved = records.saveDraft(db, draft, lockVersion, document);
    return { lockVersion: saved.lockVersion, issues: validateStandard(document, { metadata: standard }), status: "saved", message: null, submission };
  } catch (error) {
    if (error instanceof StaleRecordError) return { ...previous, status: "stale", message: "This draft was changed elsewhere after you opened it. Reload the page to continue from the latest version.", submission };
    if (error instanceof ValidationError) return { ...previous, status: "rejected", message: error.issues.map((issue) => issue.message).join(" "), submission };
    throw error;
  }
}

/** Publishes the draft version the operator reviewed. */
export async function publishStandard(standardId: string, formData: FormData): Promise<void> {
  assertStandardId(standardId);
  let releaseId: string;
  try {
    releaseId = publishDraft(getDb(), standardId, lockVersion(formData)).publicId;
  } catch (error) {
    if (error instanceof StaleRecordError) redirect(routes.standardPublish(standardId, { notice: "stale" }));
    // The publication review lists the problems itself, so the redirect carries no notice (feedback spec).
    if (error instanceof ValidationError) redirect(routes.standardPublish(standardId));
    throw error;
  }
  redirect(routes.release(standardId, releaseId, { notice: "published" }));
}

export async function reviseStandard(standardId: string, releaseId: string): Promise<void> {
  assertStandardId(standardId);
  requirePublicId(releaseId, "rel", "Release");
  try {
    reviseRelease(getDb(), releaseId);
  } catch (error) {
    if (error instanceof ValidationError) redirect(routes.standard(standardId, { notice: "draft_exists" }));
    throw error;
  }
  redirect(routes.standardDraft(standardId, { notice: "revision" }));
}
