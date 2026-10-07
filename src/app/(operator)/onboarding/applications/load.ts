import { cache } from "react";
import type { Step } from "@/components/onboarding/steps";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { findApplication } from "@/lib/ownership/records";
import type { ValidationIssue } from "@/lib/onboarding/issues";

export const applicationHref = (publicId: string) => `/onboarding/applications/${publicId}`;
export const applicationCrumbs = [{ href: "/onboarding/applications", label: "Web Applications" }];

export const APPLICATION_STEPS = [
  { id: "identity", label: "Name and owner" },
  { id: "launch", label: "Launch target" },
  { id: "composition", label: "Composition" },
  { id: "placements", label: "Placements" },
  { id: "review", label: "Review and submit" },
] as const;
export type ApplicationStep = (typeof APPLICATION_STEPS)[number]["id"];

export const applicationStepHref = (publicId: string, step: ApplicationStep) => `${applicationHref(publicId)}/draft/${step}`;

/** The step a validation issue is about. Values kept from the earlier format are reviewed with the identity. */
export function applicationStepOf(location: string): ApplicationStep {
  if (location.startsWith("launch")) return "launch";
  if (location.startsWith("children")) return "composition";
  if (location.startsWith("placements")) return "placements";
  return "identity";
}

export function applicationSteps(publicId: string, issues: readonly ValidationIssue[]): Step[] {
  return APPLICATION_STEPS.map((step) => ({ id: step.id, label: step.label, href: applicationStepHref(publicId, step.id), issues: step.id === "review" ? undefined : issues.filter((issue) => issue.severity === "blocking" && applicationStepOf(issue.location) === step.id).length }));
}

/** The Web Application a page is about, read once per request. Applications claimed before onboarding keep their legacy sea_ IDs. */
export const loadApplication = cache((publicId: string) => {
  if (!isPublicId(publicId, "wap") && !isPublicId(publicId, "sea")) return null;
  const db = getDb();
  const application = findApplication(db, publicId);
  return application ? { db, application } : null;
});
