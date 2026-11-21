import { HAR_UPLOAD_LIMIT } from "./har-import";
import { MB, NAME_LIMIT } from "./model";

/*
 * Why Upload HAR sends the operator back (add-mock-sets, design decision 12,
 * step 1; mock-set-import spec): the upload's route handler answers 303 to
 * the upload page with one of these codes, and the page says it on the field
 * it's about, so the form works without JavaScript.
 */

export const UPLOAD_ERRORS = {
  confirm: { field: "confirm", message: "Confirm that the recording holds only synthetic test data." },
  file: { field: "file", message: "Choose a HAR file." },
  "too-large": { field: "file", message: `A HAR file can have up to ${HAR_UPLOAD_LIMIT / MB} MB. Export only the calls you need, or record a shorter session.` },
  "not-har": { field: "file", message: "This file isn't a HAR file. Export one from the browser's network panel: in Chrome or Edge, choose Export HAR; in Firefox, Save All As HAR; in Safari, Export." },
  busy: { field: "file", message: "Two uploads are being read. Try again in a minute." },
  name: { field: "name", message: "Enter a name for the new mock set." },
  "name-length": { field: "name", message: `Use at most ${NAME_LIMIT} characters.` },
  "set-gone": { field: "target", message: "That mock set no longer exists. Someone else deleted it. Choose another, or a new mock set." },
} as const;

export type UploadError = keyof typeof UPLOAD_ERRORS;

/**
 * The field and message of the error code +code+, or null for none or an unknown one.
 * @public Upload HAR uses this (add-mock-sets, task 5.5).
 */
export function uploadProblem(code: string | null | undefined): (typeof UPLOAD_ERRORS)[UploadError] | null {
  return code && Object.hasOwn(UPLOAD_ERRORS, code) ? UPLOAD_ERRORS[code as UploadError] : null;
}
