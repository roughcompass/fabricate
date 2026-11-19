"use server";

import { notFound, redirect } from "next/navigation";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { requireApplications } from "@/lib/applications/availability";
import { buildRef } from "@/lib/applications/preview-mode";
import { findApplication } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { PreviewAccessError } from "@/lib/previews/access";
import { RefResolutionError } from "@/lib/previews/refs";
import { deviceQuery, parseDeviceState } from "@/lib/web/device-preview";
import { text } from "@/lib/web/form-data";
import { routes } from "@/lib/web/routes";

/**
 * Shows another branch or tag in preview mode (template-preview spec,
 * "Preview mode can show another branch or tag"): builds the application's
 * package at its head as a repository preview, unless it's built or being
 * built, and opens preview mode at it. The tracked branch is preview mode's
 * own address, without a ref; choosing a ref never changes the application.
 */
export async function showRef(slug: string, formData: FormData): Promise<void> {
  requireApplications();
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  const ref = text(formData, "ref", 300);
  const device = deviceQuery(parseDeviceState({ device: text(formData, "device", 20), orientation: text(formData, "orientation", 20) }));
  if (!ref || ref === application.trackedRef) redirect(routes.applicationPreview(slug, device));
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
