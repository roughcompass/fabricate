/**
 * The addresses of Portal pages (runtime-configuration spec): the Portals
 * page, each Portal's page, its Experience Editor, and its configuration
 * sections, all under /portals. A plain module, so the sidebar can build its
 * sub-menu from them.
 */

export const PORTALS_HREF = "/portals";

/** Where Runtime Configuration in the primary menu leads; it redirects to the current Portal's Experience Editor, or to the Portals page. */
export const RUNTIME_CONFIGURATION_HREF = "/runtime-configuration";

/** A Portal's page: its details, lifecycle, menu, and history. */
export function portalHref(portalPublicId: string): string {
  return `${PORTALS_HREF}/${portalPublicId}`;
}

/** The Experience Editor's views, as header tabs (experience-editor spec, "Header tabs switch between three views"). */
export const EDITOR_VIEWS = ["frame-zones", "frame-overlays", "capabilities"] as const;
export type EditorViewId = (typeof EDITOR_VIEWS)[number];

/** The Experience Editor's base address, which its views and pages extend. */
export function editorBase(portalPublicId: string): string {
  return `${portalHref(portalPublicId)}/editor`;
}

/** A Portal's Experience Editor, at +view+: a view, or a full-window page such as "messages", "menu", or "change-history". */
export function editorHref(portalPublicId: string, view = "frame-zones"): string {
  return `${portalHref(portalPublicId)}/editor/${view}`;
}

/** A Portal's configuration section, such as "favicon". */
export function configurationHref(portalPublicId: string, section: string): string {
  return `${portalHref(portalPublicId)}/configuration/${section}`;
}
