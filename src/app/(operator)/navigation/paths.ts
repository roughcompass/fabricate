/** The Navigation section's addresses (navigation spec). */
export const NAVIGATION_HREF = "/navigation";

export const navigationCrumbs = [{ href: `${NAVIGATION_HREF}?portal=all`, label: "Navigation" }];

/** A Portal's Navigation page. */
export function navigationHref(portalPublicId: string): string {
  return `${NAVIGATION_HREF}/${portalPublicId}`;
}

/** The experience editor's views and pages (experience-editor spec). */
export const EDITOR_VIEWS = ["frame-zones", "frame-overlays", "capabilities", "configuration"] as const;
export type EditorViewId = (typeof EDITOR_VIEWS)[number];

/** A Portal's experience editor, at +view+: a view, a configuration section ("configuration/favicon"), or a full-window page. */
export function editorHref(portalPublicId: string, view = "frame-zones"): string {
  return `${navigationHref(portalPublicId)}/editor/${view}`;
}
