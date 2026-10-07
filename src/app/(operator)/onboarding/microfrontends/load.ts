import { cache } from "react";
import type { Step } from "@/components/onboarding/steps";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { applicationName } from "@/lib/onboarding/applications";
import type { ValidationIssue } from "@/lib/onboarding/issues";
import { findMicrofrontend } from "@/lib/onboarding/microfrontends";
import { findApplication } from "@/lib/ownership/records";
import { applicationHref, applicationStepHref } from "../applications/load";

/*
 * MFE pages. An MFE is a shared asset Application teams manage from an
 * Application's composition, so its pages sit under Web Applications. Opened
 * from a composition, a page carries the Application's ID in `from`: its
 * breadcrumbs lead back there, and saving or submitting returns to the same
 * composition. Without it, the page is a deep link and leads to the MFE list.
 */

export const mfeHref = (publicId: string) => `/onboarding/microfrontends/${publicId}`;
export const mfeCrumbs = [
  { href: "/onboarding/applications", label: "Web Applications" },
  { href: "/onboarding/microfrontends", label: "MFEs" },
];

export const MFE_STEPS = [
  { id: "identity", label: "Name and owner" },
  { id: "source", label: "Built from" },
  { id: "cdaas", label: "CDaaS view" },
  { id: "rendering", label: "Rendering" },
  { id: "review", label: "Review and submit" },
] as const;
export type MfeStep = (typeof MFE_STEPS)[number]["id"];

export const mfeStepHref = (publicId: string, step: MfeStep) => `${mfeHref(publicId)}/draft/${step}`;

/** The step a validation issue is about. Values kept from the earlier format are reviewed with the identity. */
export function mfeStepOf(location: string): MfeStep {
  if (location.startsWith("repository") || location.startsWith("workspacePath")) return "source";
  if (location.startsWith("cdaas")) return "cdaas";
  if (location.startsWith("rendering")) return "rendering";
  return "identity";
}

export function mfeSteps(publicId: string, issues: readonly ValidationIssue[], from: string | null = null): Step[] {
  return MFE_STEPS.map((step) => ({ id: step.id, label: step.label, href: withOrigin(mfeStepHref(publicId, step.id), from), issues: step.id === "review" ? undefined : issues.filter((issue) => issue.severity === "blocking" && mfeStepOf(issue.location) === step.id).length }));
}

/** +href+ carrying the Application it was opened from, before any fragment. */
export function withOrigin(href: string, from: string | null | undefined): string {
  if (!from) return href;
  const [path, fragment] = href.split("#", 2);
  return `${path}${path!.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}${fragment !== undefined ? `#${fragment}` : ""}`;
}

export interface Origin {
  publicId: string;
  name: string;
  /** Where the page returns: the Application Draft's composition step. */
  compositionHref: string;
}

/** The Application an MFE page was opened from, when `from` names one that exists. */
export function originOf(from: string | null | undefined): Origin | null {
  if (!from || (!isPublicId(from, "wap") && !isPublicId(from, "sea"))) return null;
  const application = findApplication(getDb(), from);
  return application ? { publicId: application.publicId, name: applicationName(application), compositionHref: applicationStepHref(application.publicId, "composition") } : null;
}

/** An MFE page's breadcrumbs: back to the composition it was opened from, or to the MFE list. */
export function mfeCrumbsFor(origin: Origin | null) {
  return origin
    ? [
        { href: "/onboarding/applications", label: "Web Applications" },
        { href: applicationHref(origin.publicId), label: origin.name },
        { href: origin.compositionHref, label: "Composition" },
      ]
    : mfeCrumbs;
}

export const loadMicrofrontend = cache((publicId: string) => {
  if (!isPublicId(publicId, "mfe")) return null;
  const db = getDb();
  const microfrontend = findMicrofrontend(db, publicId);
  return microfrontend ? { db, microfrontend } : null;
});
