"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CloneUrl } from "@/lib/catalog/clone-url";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { SEAL_ID, completeClaim, confirmPortalOwner, correctOwnership, locateRepository } from "@/lib/ownership/claims";
import { refreshDeConsole } from "@/lib/ownership/de-console";
import { errorsFrom, text, texts } from "@/lib/web/form-data";
import { CLAIMANT_COOKIE, type ClaimFormState, type ClaimFormValues } from "./form-state";

const claimPath = (sourcePublicId: string, query = "") => `/repositories/claim/${sourcePublicId}${query}`;

function assertSourceId(publicId: string): void {
  if (!isPublicId(publicId, "src")) throw new NotFoundError("Unknown repository source");
}

/** A choice from a list, or a value typed beside it, but not both. */
function oneOf(formData: FormData, field: string, max: number, message: string): { value: string; error?: string } {
  const listed = text(formData, field, max).trim();
  const other = text(formData, `${field}Other`, max).trim();
  if (listed && other && listed.toLowerCase() !== other.toLowerCase()) return { value: "", error: message };
  return { value: other || listed };
}

/** Portals checked from the list, plus any typed in, separated by commas. */
function portalsFrom(formData: FormData): string[] {
  return [...texts(formData, "portals", 120, 40), ...text(formData, "portalsOther", 2_000).split(",")].map((value) => value.trim()).filter(Boolean);
}

function claimantFrom(formData: FormData) {
  return { providedBy: text(formData, "providedBy", 300), attributedTo: text(formData, "attributedTo", 300) };
}

async function remember(providedBy: string): Promise<void> {
  const value = providedBy.trim().slice(0, 200);
  if (value) (await cookies()).set(CLAIMANT_COOKIE, value, { httpOnly: true, sameSite: "lax", path: "/repositories/claim", maxAge: 60 * 60 * 24 * 90 });
}

function rejected(values: ClaimFormValues, error: ValidationError): ClaimFormState {
  return { values, errors: errorsFrom(error) };
}

function formValues(formData: FormData, fields: readonly string[]): ClaimFormValues {
  const values: ClaimFormValues = {};
  for (const field of fields) values[field] = field === "portals" ? texts(formData, field, 120, 40) : text(formData, field, 2_000);
  return values;
}

/** Step one: the git URL. A rejected URL is echoed back only in its redacted form. */
export async function startClaim(_previous: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  const url = text(formData, "cloneUrl", 2_048);
  let location: string;
  try {
    const { source, created } = locateRepository(getDb(), url);
    location = claimPath(source.publicId, created ? `?notice=registered&source=${source.publicId}` : "");
  } catch (error) {
    if (error instanceof ValidationError) return rejected({ cloneUrl: CloneUrl.redact(url) }, error);
    throw error;
  }
  redirect(location);
}

/** Step two: the SEAL ID. Choosing one reads the DE Console, and a failed read doesn't stop the claim. */
export async function chooseSealId(sourcePublicId: string, _previous: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  assertSourceId(sourcePublicId);
  const values = formValues(formData, ["sealId", "sealIdOther"]);
  const choice = oneOf(formData, "sealId", 80, "Choose a listed SEAL ID or enter another, not both");
  if (choice.error) return { values, errors: { sealIdOther: [choice.error] } };
  if (!choice.value) return { values, errors: { sealId: ["Choose or enter a SEAL ID"] } };
  if (!SEAL_ID.test(choice.value)) return { values, errors: { [values.sealIdOther ? "sealIdOther" : "sealId"]: ["Enter a SEAL ID of letters, digits, dots, dashes, or underscores"] } };
  await refreshDeConsole(getDb(), getConfig(), "claim");
  redirect(claimPath(sourcePublicId, `?seal=${encodeURIComponent(choice.value)}`));
}

const QUESTION_FIELDS = ["sealId", "team", "lineOfBusiness", "lineOfBusinessOther", "portals", "portalsOther", "hosts", "hostsOther", "providedBy", "attributedTo"] as const;

/** Step three: the answers still needed, the claimant, and an optional portal the repository hosts. */
export async function submitClaim(sourcePublicId: string, _previous: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  assertSourceId(sourcePublicId);
  const values = formValues(formData, QUESTION_FIELDS);
  const lineOfBusiness = oneOf(formData, "lineOfBusiness", 120, "Choose a listed Line of Business or enter another, not both");
  const hosts = oneOf(formData, "hosts", 120, "Choose a listed portal or enter another, not both");
  if (lineOfBusiness.error || hosts.error) {
    return { values, errors: { ...(lineOfBusiness.error && { lineOfBusinessOther: [lineOfBusiness.error] }), ...(hosts.error && { hostsOther: [hosts.error] }) } };
  }

  let location: string;
  try {
    const claimant = claimantFrom(formData);
    const result = completeClaim(getDb(), sourcePublicId, {
      ...claimant,
      sealId: text(formData, "sealId", 80),
      team: text(formData, "team", 300),
      lineOfBusiness: lineOfBusiness.value,
      portals: portalsFrom(formData),
      hosts: hosts.value,
      launchToken: text(formData, "launchToken", 40),
    });
    await remember(claimant.providedBy);
    location = result.ownerProposal ? claimPath(sourcePublicId, `/owner?portal=${result.ownerProposal.publicId}`) : claimPath(sourcePublicId, `?notice=${result.started ? "claimed-started" : "claimed"}&source=${sourcePublicId}`);
  } catch (error) {
    if (error instanceof ValidationError) return rejected(values, error);
    throw error;
  }
  redirect(location);
}

/** Confirms the repository's application as owner of the unowned portal it hosts. */
export async function confirmOwner(sourcePublicId: string, portalPublicId: string, _previous: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  assertSourceId(sourcePublicId);
  const values = formValues(formData, ["providedBy", "attributedTo"]);
  try {
    const claimant = claimantFrom(formData);
    confirmPortalOwner(getDb(), sourcePublicId, portalPublicId, claimant);
    await remember(claimant.providedBy);
  } catch (error) {
    if (error instanceof ValidationError) return rejected(values, error);
    throw error;
  }
  redirect(claimPath(sourcePublicId, `?notice=owner-confirmed&source=${sourcePublicId}`));
}

const CORRECTION_FIELDS = ["sealId", "team", "lineOfBusiness", "lineOfBusinessOther", "portals", "portalsOther", "providedBy", "attributedTo"] as const;

/** Corrections: each changed value supersedes the claims it replaces. */
export async function submitCorrection(sourcePublicId: string, _previous: ClaimFormState, formData: FormData): Promise<ClaimFormState> {
  assertSourceId(sourcePublicId);
  const values = formValues(formData, CORRECTION_FIELDS);
  const lineOfBusiness = oneOf(formData, "lineOfBusiness", 120, "Choose a listed Line of Business or enter another, not both");
  let location: string;
  try {
    if (lineOfBusiness.error) throw new ValidationError([{ field: "lineOfBusinessOther", message: lineOfBusiness.error }]);
    const claimant = claimantFrom(formData);
    const { sealChanged } = correctOwnership(getDb(), sourcePublicId, {
      ...claimant,
      sealId: text(formData, "sealId", 80),
      team: text(formData, "team", 300),
      lineOfBusiness: lineOfBusiness.value,
      portals: portalsFrom(formData),
    });
    await remember(claimant.providedBy);
    location = claimPath(sourcePublicId, `?notice=${sealChanged ? "seal-corrected" : "corrected"}&source=${sourcePublicId}`);
  } catch (error) {
    if (error instanceof ValidationError) return rejected(values, error);
    throw error;
  }
  redirect(location);
}
