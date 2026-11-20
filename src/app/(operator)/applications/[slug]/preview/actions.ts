"use server";

import { notFound, redirect } from "next/navigation";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { requireApplications } from "@/lib/applications/availability";
import { createSavedPreview } from "@/lib/applications/pipeline";
import { buildRef } from "@/lib/applications/preview-mode";
import { findApplication } from "@/lib/applications/records";
import { savedPreviewOfRef } from "@/lib/applications/saved-previews";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { PreviewAccessError } from "@/lib/previews/access";
import { RefResolutionError } from "@/lib/previews/refs";
import { deviceQuery, parseDeviceState } from "@/lib/web/device-preview";
import { text } from "@/lib/web/form-data";
import { routes } from "@/lib/web/routes";

/** The application the action is for, the ref the form names, and the device to keep. */
function shownFrom(slug: string, formData: FormData) {
  requireApplications();
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  const device = deviceQuery(parseDeviceState({ device: text(formData, "device", 20), orientation: text(formData, "orientation", 20) }));
  return { application, ref: text(formData, "ref", 300), device };
}

/**
 * Shows another branch or tag in preview mode (template-preview spec,
 * "Preview mode can show another branch or tag"): builds the application's
 * package at its head as a repository preview, unless it's built or being
 * built, and opens preview mode at it. The tracked branch is preview mode's
 * own address, without a ref, and a saved preview opens by its key, with no
 * build; choosing a ref never changes the application.
 */
export async function showRef(slug: string, formData: FormData): Promise<void> {
  const { application, ref, device } = shownFrom(slug, formData);
  if (!ref || ref === application.trackedRef) redirect(routes.applicationPreview(slug, device));
  const saved = savedPreviewOfRef(getDb(), application.publicId, ref);
  if (saved) redirect(routes.applicationPreview(slug, { preview: saved.key, ...device }));
  let notice: string | undefined;
  try {
    await buildRef(getDb(), application, ref);
  } catch (error) {
    if (error instanceof PreviewAccessError) notFound();
    if (!(error instanceof RefResolutionError || error instanceof AcquisitionError)) throw error;
    notice = "unreadable";
  }
  redirect(routes.applicationPreview(slug, { ref, ...device, ...(notice && { notice }) }));
}

/**
 * Saves the unsaved branch or tag shown as one of the application's saved
 * previews (applications/saved-previews spec, "Saved previews are created
 * from the application page or preview mode"), reusing the build Show made,
 * and opens preview mode on it by its key. An application that keeps 20
 * previews already says so, and saves nothing.
 */
export async function saveAsPreview(slug: string, formData: FormData): Promise<void> {
  const { application, ref, device } = shownFrom(slug, formData);
  let key: string;
  try {
    key = (await createSavedPreview(getDb(), application.publicId, { ref })).saved.key;
  } catch (error) {
    if (error instanceof PreviewAccessError) notFound();
    if (error instanceof ValidationError) redirect(routes.applicationPreview(slug, { ...(ref !== application.trackedRef && { ref }), ...device, notice: "limit" }));
    if (!(error instanceof RefResolutionError || error instanceof AcquisitionError)) throw error;
    redirect(routes.applicationPreview(slug, { ref, ...device, notice: "unreadable" }));
  }
  redirect(routes.applicationPreview(slug, { preview: key, ...device }));
}
