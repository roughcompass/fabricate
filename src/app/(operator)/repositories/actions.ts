"use server";

import { redirect } from "next/navigation";
import { addRepositories } from "@/lib/catalog/bulk-add";
import { deleteSource, editSource, registerSource, type SourceForm } from "@/lib/catalog/catalog";
import { getSource } from "@/lib/catalog/source-records";
import { CloneUrl } from "@/lib/catalog/clone-url";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { requirePublicId } from "@/lib/db/ids";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { surveyRepository } from "@/lib/surveys/background";
import { lockVersion, submitForm } from "@/lib/web/actions";
import { errorsFrom, text } from "@/lib/web/form-data";
import { withQuery } from "@/lib/web/query";
import type { BulkFormState } from "./bulk/bulk-state";
import type { SourceFormState } from "./source-form-state";
import { routes } from "@/lib/web/routes";

function readForm(formData: FormData): SourceForm {
  return { name: text(formData, "name", 500), cloneUrl: text(formData, "cloneUrl", 2_048), gitRef: text(formData, "gitRef", 300) };
}

/** Form values safe to render back: a rejected secret is never echoed. */
function safeValues(form: SourceForm): SourceForm {
  return { ...form, cloneUrl: CloneUrl.redact(form.cloneUrl) };
}

const repositoryId = (publicId: string) => requirePublicId(publicId, "src", "repository source");

export async function createSource(_previous: SourceFormState, formData: FormData): Promise<SourceFormState> {
  const form = readForm(formData);
  return submitForm(safeValues(form), () => withQuery(routes.repositories, { notice: "added", source: registerSource(getDb(), form).publicId }));
}

export async function updateSource(publicId: string, _previous: SourceFormState, formData: FormData): Promise<SourceFormState> {
  repositoryId(publicId);
  const form = readForm(formData);
  return submitForm(
    safeValues(form),
    () => {
      editSource(getDb(), publicId, lockVersion(formData), form);
      return withQuery(routes.repositorySettings(publicId), { notice: "updated" });
    },
    "This source was changed by someone else. Reload the page to review the current values, then try again.",
  );
}

/**
 * Surveys a Repository's configured reference again (unify-surveys, design
 * decision 5): reads which commit it names and queues a survey unless one
 * with the current recipe already succeeded or is on its way, which a
 * repeated submission finds too. Returns to the Repository's page, or to the
 * list when it was chosen there.
 */
export async function reprofileSource(formData: FormData): Promise<void> {
  const publicId = repositoryId(text(formData, "publicId", 40));
  let notice: string;
  try {
    const result = await surveyRepository(getDb(), getSource(getDb(), publicId), "manual");
    notice = { queued: "reprofiled", active: "profiling", current: "current" }[result.status];
  } catch (error) {
    if (!(error instanceof AcquisitionError)) throw error;
    notice = "unreachable";
  }
  redirect(text(formData, "from", 10) === "list" ? withQuery(routes.repositories, { notice, source: publicId }) : withQuery(routes.repository(publicId), { notice }));
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
  if (failed.length === 0) redirect(withQuery(routes.repositories, { notice: "bulk-added", count: added }));
  return { values: { urls: failed.map((failure) => failure.text).join("\n") }, errors: {}, added, failed, submission };
}

/**
 * Deletes a Repository once the typed confirmation is its name exactly, and
 * opens the list. A confirmation that doesn't match deletes nothing.
 */
export async function deleteRepository(publicId: string, _previous: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  repositoryId(publicId);
  try {
    deleteSource(getDb(), publicId, text(formData, "confirmation", 200));
  } catch (error) {
    if (error instanceof ValidationError) return { error: error.issues.map((issue) => issue.message).join(" ") };
    throw error;
  }
  redirect(withQuery(routes.repositories, { notice: "deleted", source: publicId }));
}
