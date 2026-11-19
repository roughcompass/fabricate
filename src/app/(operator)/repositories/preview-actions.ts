"use server";

import { notFound, redirect } from "next/navigation";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { findSource } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId, requirePublicId } from "@/lib/db/ids";
import { PreviewAccessError, isEnrolled, openPreview } from "@/lib/previews/access";
import { deletePreview, requestPreview, requestRebuild } from "@/lib/previews/lifecycle";
import { requestPreparation } from "@/lib/previews/preparation";
import { PreviewRequestError } from "@/lib/previews/records";
import { type RefRequest, RefResolutionError, configuredRequest } from "@/lib/previews/refs";
import { parseDeviceState, deviceQuery } from "@/lib/web/device-preview";
import { text } from "@/lib/web/form-data";
import type { PrepareFormState } from "./preview-form-state";
import { withQuery } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";

/*
 * Repository previews from the Repository page and the preview page
 * (docs/previews.md). Each action checks the feature switch and the
 * Repository's enrollment, as the pages do, and answers not found without
 * them, so a direct POST can do no more than the page offers.
 */

/** The Repository page with the preparation +preparation+ shown in its Previews section. */
const preparationHref = (sourcePublicId: string, preparation: string) => withQuery(routes.repository(sourcePublicId), { preparation }, "previews");

/**
 * Pins the chosen branch, tag, or commit and prepares it: the Repository page
 * then shows it profiling, and what can be built once it's decided. A commit
 * SHA takes the place of the branch or tag. A ref or SHA that can't be
 * resolved, or a remote that can't be reached, is reported on the form.
 */
export async function preparePreview(sourcePublicId: string, _previous: PrepareFormState, formData: FormData): Promise<PrepareFormState> {
  requirePublicId(sourcePublicId, "src", "repository source");
  const db = getDb();
  const config = getConfig();
  const source = findSource(db, sourcePublicId);
  if (!source || !isEnrolled(config, source)) notFound();
  const values = { ref: text(formData, "ref", 300), commit: text(formData, "commit", 100).trim() };

  let request: RefRequest;
  if (values.commit !== "") request = { kind: "commit", sha: values.commit };
  else if (values.ref === "configured") request = configuredRequest(source);
  else if (/^refs\/(heads|tags)\/./.test(values.ref)) request = { kind: "ref", name: values.ref };
  else return { values, errors: { ref: ["Choose a branch or tag, or enter a commit"] } };

  let preparation: string;
  try {
    preparation = (await requestPreparation(db, source.publicId, request, { config })).publicId;
  } catch (error) {
    if (error instanceof RefResolutionError) return { values, errors: { [values.commit !== "" ? "commit" : "ref"]: [error.message] } };
    if (error instanceof AcquisitionError) return { values, errors: { base: [error.message] } };
    if (error instanceof PreviewAccessError) notFound();
    throw error;
  }
  redirect(preparationHref(source.publicId, preparation));
}

/** Builds a package of a prepared commit the operator chose, or opens its preview when it has one. */
export async function buildPreview(formData: FormData): Promise<void> {
  const sourcePublicId = text(formData, "source", 40);
  const preparation = text(formData, "preparation", 40);
  if (!isPublicId(sourcePublicId, "src") || !isPublicId(preparation, "ppr")) notFound();
  let result: ReturnType<typeof requestPreview>;
  try {
    result = requestPreview(getDb(), preparation, text(formData, "package", 1_024), getConfig());
  } catch (error) {
    // A preparation since prepared again, or a package that no longer qualifies: show the preparation as it stands.
    if (error instanceof PreviewRequestError) redirect(preparationHref(sourcePublicId, preparation));
    if (error instanceof PreviewAccessError || error instanceof NotFoundError) notFound();
    throw error;
  }
  redirect(routes.repositoryPreview(sourcePublicId, result.preview.publicId, result.created ? { notice: "queued" } : {}));
}

/** The preview the form names, while its page could be shown, with the device it was viewed on. */
function openedFrom(formData: FormData) {
  const opened = openPreview(getDb(), getConfig(), text(formData, "preview", 40));
  if (!opened) notFound();
  return { ...opened, device: deviceQuery(parseDeviceState({ device: text(formData, "device", 20), orientation: text(formData, "orientation", 20) })) };
}

/** Starts the preview's next attempt, keeping its published output serving until that attempt publishes. */
export async function rebuildPreview(formData: FormData): Promise<void> {
  const { preview, source, device } = openedFrom(formData);
  let next;
  try {
    next = requestRebuild(getDb(), preview.publicId, getConfig());
  } catch (error) {
    if (error instanceof PreviewAccessError || error instanceof NotFoundError) notFound();
    throw error;
  }
  redirect(routes.repositoryPreview(source.publicId, preview.publicId, { ...device, notice: next.attempt > preview.attempt ? "rebuilt" : "building" }));
}

/** Deletes the preview and its files, and returns to its Repository's previews. */
export async function deletePreviewAction(formData: FormData): Promise<void> {
  const { preview, source } = openedFrom(formData);
  await deletePreview(getDb(), preview.publicId, getConfig());
  redirect(withQuery(routes.repository(source.publicId), { notice: "preview-deleted", preview: preview.publicId }, "previews"));
}
