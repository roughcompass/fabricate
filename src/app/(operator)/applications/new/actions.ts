"use server";

import { notFound, redirect } from "next/navigation";
import { AcquisitionError } from "@/lib/acquisition/errors";
import { requireApplications } from "@/lib/applications/availability";
import { repositoryForCloneUrl } from "@/lib/applications/onboarding";
import { createApplication, prepareBranch } from "@/lib/applications/pipeline";
import { PAGE_SIZE, allApplications } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { PreviewAccessError } from "@/lib/previews/access";
import { RefResolutionError } from "@/lib/previews/refs";
import { errorsFrom, text } from "@/lib/web/form-data";
import { routes } from "@/lib/web/routes";
import type { BranchState, CloneUrlState, DetailsState } from "./form-states";

/*
 * Onboarding's Server Actions (applications/onboarding spec): registering or
 * finding a clone URL, checking a branch's eligibility, and creating the
 * application. Each step's state travels in the address, so every step works
 * without JavaScript; each action checks that applications are offered.
 */

/** Where onboarding was opened from, kept through every step for its back button. */
function origin(formData: FormData): { from?: string } {
  return text(formData, "from", 20) === "repository" ? { from: "repository" } : {};
}

/** Chooses the Repository a clone URL names, registering it under the catalog's rules when the catalog doesn't have it. */
export async function chooseCloneUrl(_previous: CloneUrlState, formData: FormData): Promise<CloneUrlState> {
  requireApplications();
  const values = { cloneUrl: text(formData, "cloneUrl", 2_000) };
  let repository: string;
  try {
    repository = repositoryForCloneUrl(getDb(), values.cloneUrl).repository.publicId;
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    throw error;
  }
  redirect(routes.newApplication({ repository, ...origin(formData) }));
}

/** Checks the chosen branch: pins its head and prepares that commit, then shows the result as it's decided. */
export async function checkBranch(_previous: BranchState, formData: FormData): Promise<BranchState> {
  requireApplications();
  const repository = text(formData, "repository", 40);
  const values = { branch: text(formData, "branch", 300) };
  let preparation: string;
  try {
    preparation = (await prepareBranch(getDb(), repository, values.branch)).publicId;
  } catch (error) {
    if (error instanceof RefResolutionError) return { values, errors: { branch: [error.message] } };
    if (error instanceof AcquisitionError) return { values, errors: { base: [`The remote couldn't be read: ${error.message}`] } };
    if (error instanceof NotFoundError) return { values, errors: { branch: ["Choose a branch"] } };
    if (error instanceof PreviewAccessError) notFound();
    throw error;
  }
  redirect(routes.newApplication({ repository, branch: values.branch, preparation, ...origin(formData) }));
}

/**
 * Creates the application: records it, enrolls its remote unless it's
 * enrolled already, and queues its first build, then opens Applications at
 * the page that shows its card.
 */
export async function createAction(_previous: DetailsState, formData: FormData): Promise<DetailsState> {
  requireApplications();
  const values = { name: text(formData, "name", 200), description: text(formData, "description", 1_000), trusted: text(formData, "trusted", 10) === "yes" };
  let slug: string;
  try {
    slug = createApplication(getDb(), {
      repository: text(formData, "repository", 40),
      branch: text(formData, "branch", 300),
      packageDir: text(formData, "package", 1_024),
      preparation: text(formData, "preparation", 40),
      ...values,
    }).slug;
  } catch (error) {
    if (error instanceof ValidationError) return { values, errors: errorsFrom(error) };
    if (error instanceof NotFoundError) return { values, errors: { base: ["The repository no longer exists. Start again."] } };
    if (error instanceof PreviewAccessError) notFound();
    throw error;
  }
  const position = allApplications(getDb()).findIndex((application) => application.slug === slug);
  const page = Math.floor(Math.max(0, position) / PAGE_SIZE) + 1;
  redirect(`${routes.applications}?${new URLSearchParams({ ...(page > 1 && { page: String(page) }), notice: "created", application: slug })}`);
}
