"use server";

import { redirect } from "next/navigation";
import { ApplicationValidationError, applicationHref, createApplication } from "@/lib/applications/applications";
import { launchApplicationAssessment } from "@/lib/applications/assessment";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { UNSTATED_ACTOR, statedActor } from "@/lib/onboarding/attribution";
import { rememberedActor } from "@/lib/web/actor-cookie";
import { errorsFrom, submittedValues, text } from "@/lib/web/form-data";
import type { CreateApplicationState } from "./create-state";

/**
 * Creates an Application from Create Application (application-creation
 * spec, "Creating an application registers and assesses it"), attributed to
 * the remembered name or "Not stated", Unverified, then starts its DE Web
 * assessment without waiting and opens its dashboard. A refused submission
 * keeps every value except a repository URL with credentials.
 */
export async function createApplicationAction(_previous: CreateApplicationState, formData: FormData): Promise<CreateApplicationState> {
  const values = submittedValues(formData);
  const config = getConfig();
  let location: string;
  try {
    const actor = statedActor((await rememberedActor()) || UNSTATED_ACTOR);
    const application = createApplication(
      getDb(),
      { sealId: text(formData, "sealId", 100), name: text(formData, "name", 300), slug: text(formData, "slug", 100), description: text(formData, "description", 1000), repositoryUrl: text(formData, "repositoryUrl", 2000), portal: text(formData, "portal", 40), starter: text(formData, "starter", 100) },
      actor,
      config,
    );
    // A launch that can't start is recorded on the Application, and the dashboard says so.
    launchApplicationAssessment(getDb(), application.publicId, config);
    location = `${applicationHref(application.publicId)}?notice=created`;
  } catch (error) {
    if (!(error instanceof ApplicationValidationError)) throw error;
    const links = Object.fromEntries(error.issues.filter((issue) => issue.link).map((issue) => [issue.field, issue.link!]));
    const credentials = error.issues.some((issue) => issue.field === "repositoryUrl" && /credentials/.test(issue.message));
    return { values: credentials ? { ...values, repositoryUrl: "" } : values, errors: errorsFrom(error), links };
  }
  redirect(location);
}
