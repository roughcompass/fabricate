"use server";

import { redirect } from "next/navigation";
import { LAUNCH_TOKEN } from "@/lib/assessments/assessment-records";
import { addRepositories } from "@/lib/catalog/bulk-add";
import { deleteSource, editSource, registerSource, type SourceForm } from "@/lib/catalog/catalog";
import { getSource } from "@/lib/catalog/source-records";
import { CloneUrl } from "@/lib/catalog/clone-url";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { queueProfile } from "@/lib/profiling/versions";
import { repositoryHref, settingsHref } from "@/lib/web/repository-paths";
import { errorsFrom, integer, text } from "@/lib/web/form-data";
import type { BulkFormState } from "./bulk/bulk-state";
import type { SourceFormState } from "./source-form-state";

function readForm(formData: FormData): SourceForm {
  return { name: text(formData, "name", 500), cloneUrl: text(formData, "cloneUrl", 2_048), gitRef: text(formData, "gitRef", 300) };
}

/** Form values safe to render back: a rejected secret is never echoed. */
function safeValues(form: SourceForm): SourceForm {
  return { ...form, cloneUrl: CloneUrl.redact(form.cloneUrl) };
}

export async function createSource(_previous: SourceFormState, formData: FormData): Promise<SourceFormState> {
  const form = readForm(formData);
  let publicId: string;
  try {
    publicId = registerSource(getDb(), form).publicId;
  } catch (error) {
    if (error instanceof ValidationError) return { values: safeValues(form), errors: errorsFrom(error) };
    throw error;
  }
  redirect(`/repositories?notice=added&source=${publicId}`);
}

export async function updateSource(publicId: string, previous: SourceFormState, formData: FormData): Promise<SourceFormState> {
  if (!isPublicId(publicId, "src")) throw new NotFoundError("Unknown repository source");
  const form = readForm(formData);
  const lockVersion = integer(formData, "lockVersion");

  try {
    if (lockVersion === null) throw new StaleRecordError("Missing lock version");
    editSource(getDb(), publicId, lockVersion, form);
  } catch (error) {
    if (error instanceof ValidationError) return { ...previous, values: safeValues(form), errors: errorsFrom(error) };
    if (error instanceof StaleRecordError) {
      return {
        ...previous,
        values: safeValues(form),
        errors: { base: ["This source was changed by someone else. Reload the page to review the current values, then try again."] },
      };
    }
    throw error;
  }
  redirect(`${settingsHref(publicId)}?notice=updated`);
}

/**
 * Queues a new profile version of a Repository, unless one is queued or
 * running. The page's launch token makes a repeated submission name the
 * version it already queued. Returns to the Repository's page, or to the
 * list when it was chosen there.
 */
export async function reprofileSource(formData: FormData): Promise<void> {
  const publicId = text(formData, "publicId", 40);
  if (!isPublicId(publicId, "src")) throw new NotFoundError("Unknown repository source");
  const token = text(formData, "launchToken", 40);
  const result = queueProfile(getDb(), getSource(getDb(), publicId), "manual", { launchToken: LAUNCH_TOKEN.test(token) ? token : undefined });
  const notice = result.status === "queued" ? "reprofiled" : "profiling";
  redirect(text(formData, "from", 10) === "list" ? `/repositories?notice=${notice}&source=${publicId}` : `${repositoryHref(publicId)}?notice=${notice}`);
}

/**
 * Adds every pasted clone URL it can. When all are added, opens the list
 * with a count; otherwise keeps only the refused lines in the form, each
 * with why.
 */
export async function addRepositoriesInBulk(previous: BulkFormState, formData: FormData): Promise<BulkFormState> {
  const urls = text(formData, "urls", 200_000);
  const submission = (previous.submission ?? 0) + 1;
  let added: number;
  let failed: BulkFormState["failed"];
  try {
    const result = addRepositories(getDb(), urls);
    added = result.created.length;
    failed = result.failed;
  } catch (error) {
    if (error instanceof ValidationError) return { values: { urls }, errors: errorsFrom(error), added: 0, failed: [], submission };
    throw error;
  }
  if (failed.length === 0) redirect(`/repositories?notice=bulk-added&count=${added}`);
  return { values: { urls: failed.map((failure) => failure.text).join("\n") }, errors: {}, added, failed, submission };
}

/**
 * Deletes a Repository once the typed confirmation is its name exactly, and
 * opens the list. A confirmation that doesn't match deletes nothing.
 */
export async function deleteRepository(publicId: string, _previous: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  if (!isPublicId(publicId, "src")) throw new NotFoundError("Unknown repository source");
  try {
    deleteSource(getDb(), publicId, text(formData, "confirmation", 200));
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.issues.map((issue) => issue.message).join(" ") };
    throw error;
  }
  redirect(`/repositories?notice=deleted&source=${publicId}`);
}
