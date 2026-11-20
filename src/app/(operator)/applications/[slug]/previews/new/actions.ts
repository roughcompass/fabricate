"use server";

import { notFound, redirect } from "next/navigation";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { requireApplications } from "@/lib/applications/availability";
import { createSavedPreview } from "@/lib/applications/pipeline";
import { findApplication } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { ValidationError } from "@/lib/db/errors";
import { PreviewAccessError } from "@/lib/previews/access";
import { RefResolutionError } from "@/lib/previews/refs";
import { errorsFrom, text } from "@/lib/web/form-data";
import { routes } from "@/lib/web/routes";
import type { NewPreviewFormState } from "./form-state";

/**
 * Create preview (applications/saved-previews spec, "Saved previews are
 * created from the application page or preview mode"): saves a preview of
 * the branch or tag chosen and opens preview mode on it, showing its build
 * state. A ref already saved opens its existing preview. The tracked branch,
 * an application at its limit, and a ref the remote can't give are refused
 * on the form.
 */
export async function createPreviewAction(slug: string, _previous: NewPreviewFormState, formData: FormData): Promise<NewPreviewFormState> {
  requireApplications();
  const application = findApplication(getDb(), slug);
  if (!application) notFound();
  const values = { ref: text(formData, "ref", 300) };
  let key: string;
  try {
    key = (await createSavedPreview(getDb(), application.publicId, values)).saved.key;
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof RefResolutionError) return { values, errors: { ref: [error.message] } };
    if (error instanceof AcquisitionError) return { values, errors: { ref: [`The remote couldn't be read: ${error.message}`] } };
    if (error instanceof PreviewAccessError) notFound();
    throw error;
  }
  redirect(routes.applicationPreview(slug, { preview: key }));
}
