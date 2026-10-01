"use server";

import { parseCanonical } from "@repo-facts/contract";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { publishDraft, reviseRelease } from "@/lib/standards/publish";
import * as records from "@/lib/standards/standard-records";
import { validateStandard } from "@/lib/standards/validate";
import { errorsFrom, integer, text } from "@/lib/web/form-data";
import type { DraftSaveState, StandardFormState, StandardFormValues } from "./form-state";

/** The largest draft document a save accepts, in characters. */
const MAX_DRAFT_LENGTH = 512 * 1024;

function readMetadata(formData: FormData): StandardFormValues {
  return { name: text(formData, "name", 500), purpose: text(formData, "purpose", 4_000) };
}

function assertStandardId(publicId: string): void {
  if (!isPublicId(publicId, "std")) throw new NotFoundError("Unknown Standard");
}

export async function createStandard(_previous: StandardFormState, formData: FormData): Promise<StandardFormState> {
  const values = readMetadata(formData);
  let publicId: string;
  try {
    publicId = records.createStandard(getDb(), values).standard.publicId;
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    throw error;
  }
  redirect(`/standards/${publicId}/draft?notice=created`);
}

export async function updateStandard(standardId: string, _previous: StandardFormState, formData: FormData): Promise<StandardFormState> {
  assertStandardId(standardId);
  const values = readMetadata(formData);
  try {
    records.updateStandardMetadata(getDb(), standardId, integer(formData, "lockVersion") ?? -1, values);
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof StaleRecordError) return { values, errors: { base: ["This Standard was changed by someone else. Reload it and try again."] } };
    throw error;
  }
  redirect(`/standards/${standardId}?notice=updated`);
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
  if (!draft) redirect(`/standards/${standardId}?notice=no_draft`);
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
    releaseId = publishDraft(getDb(), standardId, integer(formData, "lockVersion") ?? -1).publicId;
  } catch (error) {
    if (error instanceof StaleRecordError) redirect(`/standards/${standardId}/publish?notice=stale`);
    if (error instanceof ValidationError) redirect(`/standards/${standardId}/publish?notice=invalid`);
    throw error;
  }
  redirect(`/standards/${standardId}/releases/${releaseId}?notice=published`);
}

export async function reviseStandard(standardId: string, releaseId: string): Promise<void> {
  assertStandardId(standardId);
  if (!isPublicId(releaseId, "rel")) throw new NotFoundError("Unknown Release");
  try {
    reviseRelease(getDb(), releaseId);
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/standards/${standardId}?notice=draft_exists`);
    throw error;
  }
  redirect(`/standards/${standardId}/draft?notice=revision`);
}
