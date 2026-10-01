"use server";

import { redirect } from "next/navigation";
import { disableSource, editSource, enableSource, registerSource, type SourceForm } from "@/lib/catalog/catalog";
import { CloneUrl } from "@/lib/catalog/clone-url";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { errorsFrom, integer, text } from "@/lib/web/form-data";
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
  redirect(`/repositories?notice=updated&source=${publicId}`);
}

export async function setSourceEnabled(formData: FormData): Promise<void> {
  const publicId = text(formData, "publicId", 40);
  const enabled = text(formData, "enabled", 5) === "true";
  if (!isPublicId(publicId, "src")) throw new NotFoundError("Unknown repository source");

  try {
    if (enabled) enableSource(getDb(), publicId);
    else disableSource(getDb(), publicId);
  } catch (error) {
    if (error instanceof ValidationError) redirect(`/repositories?notice=enable-conflict&source=${publicId}`);
    throw error;
  }
  redirect(`/repositories?notice=${enabled ? "enabled" : "disabled"}&source=${publicId}`);
}
