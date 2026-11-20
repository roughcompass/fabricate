"use server";

import { notFound, redirect } from "next/navigation";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { requireApplications } from "@/lib/applications/availability";
import { ApplicationBuildError, editApplication, rebuildApplication, rebuildSavedPreview } from "@/lib/applications/pipeline";
import { deleteApplication, findApplication } from "@/lib/applications/records";
import { findSavedPreview, removeSavedPreview } from "@/lib/applications/saved-previews";
import { getDb } from "@/lib/db/client";
import { NotFoundError, StaleRecordError, ValidationError } from "@/lib/db/errors";
import { PreviewAccessError } from "@/lib/previews/access";
import { RefResolutionError } from "@/lib/previews/refs";
import { errorsFrom, text } from "@/lib/web/form-data";
import { lockVersion } from "@/lib/web/actions";
import { routes } from "@/lib/web/routes";
import type { ApplicationFormState } from "./form-state";

/*
 * Applications' Server Actions (applications/catalog spec): Rebuild, the
 * settings form, and Delete; and a saved preview's Rebuild preview and
 * Remove preview (applications/saved-previews spec). Each checks that
 * applications are offered, as the pages do, and answers not found without
 * them.
 */

/** The application the form names, while it exists. */
function applicationFrom(formData: FormData) {
  requireApplications();
  const application = findApplication(getDb(), text(formData, "application", 100));
  if (!application) notFound();
  return application;
}

/** Builds the tracked branch's current commit again (builds spec, "Operators can rebuild"). */
export async function rebuildAction(formData: FormData): Promise<void> {
  const application = applicationFrom(formData);
  const notice = await rebuildNotice(() => rebuildApplication(getDb(), application.publicId));
  redirect(routes.application(application.slug, { notice }));
}

/** Starts a rebuild, and names its outcome: rebuilt, building when one is under way, or unreachable when the ref couldn't be read. */
async function rebuildNotice(rebuild: () => Promise<unknown>): Promise<"rebuilt" | "building" | "unreachable"> {
  try {
    await rebuild();
    return "rebuilt";
  } catch (error) {
    if (error instanceof ApplicationBuildError) return "building";
    if (error instanceof RefResolutionError || error instanceof AcquisitionError) return "unreachable";
    if (error instanceof PreviewAccessError || error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** The application and saved preview the form names, while both exist. */
function savedPreviewFrom(formData: FormData) {
  const application = applicationFrom(formData);
  const saved = findSavedPreview(getDb(), application.publicId, text(formData, "preview", 100));
  if (!saved) notFound();
  return { application, saved };
}

/** Builds a saved preview's branch head, or tag's commit, again (saved-previews spec, "Saved previews can be rebuilt"). */
export async function rebuildPreviewAction(formData: FormData): Promise<void> {
  const { application, saved } = savedPreviewFrom(formData);
  const notice = await rebuildNotice(() => rebuildSavedPreview(getDb(), saved.publicId));
  redirect(routes.application(application.slug, { notice: `preview-${notice}`, preview: saved.key }));
}

/** Removes a saved preview after the operator confirmed it (saved-previews spec, "Saved previews can be removed"). */
export async function removePreviewAction(formData: FormData): Promise<void> {
  const application = applicationFrom(formData);
  removeSavedPreview(getDb(), application.publicId, text(formData, "preview", 100));
  redirect(routes.application(application.slug, { notice: "preview-removed" }));
}

/** Saves the name, description, and tracked branch; a new branch is built, keeping the current build until it succeeds. */
export async function updateAction(slug: string, _previous: ApplicationFormState, formData: FormData): Promise<ApplicationFormState> {
  requireApplications();
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  const values = { name: text(formData, "name", 200), description: text(formData, "description", 1_000), branch: text(formData, "branch", 300) };
  let moved: boolean;
  try {
    moved = (await editApplication(getDb(), application.publicId, lockVersion(formData), values)).trackedRef !== application.trackedRef;
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof StaleRecordError) return { values, errors: { base: [`${application.name} was changed by someone else. Reload the page to review the current values, then try again.`] } };
    if (error instanceof RefResolutionError) return { values, errors: { branch: [error.message] } };
    if (error instanceof AcquisitionError) return { values, errors: { branch: [`The remote couldn't be read: ${error.message}`] } };
    if (error instanceof PreviewAccessError) notFound();
    throw error;
  }
  redirect(routes.application(slug, { notice: moved ? "branch" : "updated" }));
}

/** Deletes the application; its builds stay as the Repository's previews, pruned like any other. */
export async function deleteAction(formData: FormData): Promise<void> {
  const application = applicationFrom(formData);
  deleteApplication(getDb(), application.publicId);
  redirect(`${routes.applications}?notice=deleted`);
}
