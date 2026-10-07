import { cache } from "react";
import type { Step } from "@/components/onboarding/steps";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import type { ValidationIssue } from "@/lib/onboarding/issues";
import { findPortal } from "@/lib/onboarding/portals";

export const portalHref = (publicId: string) => `/onboarding/portals/${publicId}`;
export const portalCrumbs = [{ href: "/onboarding/portals", label: "Portals" }];

export const PORTAL_STEPS = [
  { id: "identity", label: "Identity" },
  { id: "environments", label: "Environments" },
  { id: "menu", label: "Menu" },
  { id: "review", label: "Review and submit" },
] as const;
export type PortalStep = (typeof PORTAL_STEPS)[number]["id"];

export const stepHref = (publicId: string, step: PortalStep) => `${portalHref(publicId)}/draft/${step}`;

/** The step, and the field on it, a validation issue is about. Values kept from the earlier format are reviewed with the identity. */
export function portalStepOf(location: string): PortalStep {
  if (location.startsWith("environments")) return "environments";
  if (location.startsWith("menu")) return "menu";
  return "identity";
}

export const fieldId = (location: string) => location.replaceAll(".", "-");

export function portalSteps(publicId: string, issues: readonly ValidationIssue[]): Step[] {
  return PORTAL_STEPS.map((step) => ({ id: step.id, label: step.label, href: stepHref(publicId, step.id), issues: step.id === "review" ? undefined : issues.filter((issue) => issue.severity === "blocking" && portalStepOf(issue.location) === step.id).length }));
}

/** The Portal a page is about, read once per request. */
export const loadPortal = cache((publicId: string) => {
  if (!isPublicId(publicId, "ptl")) return null;
  const db = getDb();
  const portal = findPortal(db, publicId);
  return portal ? { db, portal } : null;
});
