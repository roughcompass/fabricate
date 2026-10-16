import type { ApplicationAssessmentState } from "./assessment";
import type { RenderingMode } from "./vocabulary";

/*
 * An Application's Production checklist (application-dashboard spec, "The
 * production checklist tracks what's left"). Every item is derived from the
 * records it describes; nothing is ticked by hand. Items Fabricate can't
 * offer yet are Not available and don't count.
 */

export const CHECKLIST_ITEMS = ["repository", "seal_id", "assessment", "rendering", "navigation", "production", "analytics", "observability"] as const;
export type ChecklistItemId = (typeof CHECKLIST_ITEMS)[number];

export const CHECKLIST_LABELS: Record<ChecklistItemId, string> = {
  repository: "Repository connected",
  seal_id: "SEAL ID recorded",
  assessment: "DE Web assessment passed",
  rendering: "Rendering mode determined",
  navigation: "Added to Navigation",
  production: "Portal in Production",
  analytics: "Analytics enabled",
  observability: "Observability enabled",
};

export interface ChecklistItem {
  id: ChecklistItemId;
  label: string;
  state: "done" | "open" | "not_available";
  /** Where the item is done, or null when there's nowhere yet. */
  href: string | null;
}

export interface ChecklistInput {
  application: { publicId: string; sealId: string | null; renderingMode: RenderingMode | null };
  repository: { publicId: string } | null;
  portal: { publicId: string; lifecycle: "prototype" | "production" } | null;
  /** How many of the Portal's menu items point at the Application. */
  menuItems: number;
  assessment: Pick<ApplicationAssessmentState, "state" | "run">;
}

/** The eight items in order, each done, open, or not available, with how many of the available ones are done. */
export function productionChecklist(input: ChecklistInput): { items: ChecklistItem[]; completed: number; available: number } {
  const { application, repository, portal, menuItems, assessment } = input;
  const dashboard = `/applications/${application.publicId}`;
  const navigation = portal ? `/navigation/${portal.publicId}` : null;
  const state = (done: boolean): ChecklistItem["state"] => (done ? "done" : "open");
  const entries: [ChecklistItemId, ChecklistItem["state"], string | null][] = [
    ["repository", state(repository !== null), repository ? `/repositories/${repository.publicId}/edit` : null],
    ["seal_id", state(Boolean(application.sealId)), `${dashboard}?edit=details`],
    ["assessment", state(assessment.state === "assessed" || assessment.state === "assessed_with_issues"), assessment.run ? `/runs/${assessment.run.publicId}` : dashboard],
    ["rendering", state(application.renderingMode !== null && application.renderingMode !== "undetermined"), `${dashboard}#rendering`],
    ["navigation", state(menuItems > 0), navigation],
    ["production", state(portal?.lifecycle === "production"), navigation],
    ["analytics", "not_available", null],
    ["observability", "not_available", null],
  ];
  const items = entries.map(([id, itemState, href]) => ({ id, label: CHECKLIST_LABELS[id], state: itemState, href }));
  const available = items.filter((item) => item.state !== "not_available");
  return { items, completed: available.filter((item) => item.state === "done").length, available: available.length };
}
