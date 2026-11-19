import { redirect } from "next/navigation";
import type { FormState } from "@/components/ui/form";
import { StaleRecordError, ValidationError } from "@/lib/db/errors";
import { errorsFrom, integer } from "./form-data";

/*
 * The shape the form actions share (prune-and-consolidate-code, design
 * decision 7): run the change, then redirect to where it shows its outcome,
 * or return the form with its errors.
 */

/**
 * Runs +change+, which returns where to go, and redirects there. A refused
 * change returns +values+ with its field errors, or, for an edit someone
 * else saved first, +stale+ on the whole form. Anything else is thrown.
 */
export function submitForm<Values>(values: Values, change: () => string, stale = "This record was changed by someone else. Reload the page to review the current values, then try again."): FormState<Values> {
  let location: string;
  try {
    location = change();
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof StaleRecordError) return { values, errors: { base: [stale] } };
    throw error;
  }
  redirect(location);
}

/** The lock version the form was rendered with. A missing or malformed one reads as an edit someone else saved first. */
export function lockVersion(formData: FormData): number {
  const version = integer(formData, "lockVersion");
  if (version === null) throw new StaleRecordError("Missing lock version");
  return version;
}
