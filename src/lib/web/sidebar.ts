/**
 * The operator's sidebar preferences, kept in cookies so the server renders
 * the chosen width and hidden state on first paint. The cookies are not
 * httpOnly: the browser writes the width while the operator resizes.
 */
export const SIDEBAR_WIDTH_COOKIE = "frontend-registry-sidebar-width";
export const SIDEBAR_HIDDEN_COOKIE = "frontend-registry-sidebar";
export const SIDEBAR_HIDDEN = "hidden";

/** Pixel widths, mirroring --size-sidebar, --size-sidebar-min, and --size-sidebar-max in globals.css. */
export const SIDEBAR_WIDTH = { default: 256, min: 200, max: 400, step: 16 } as const;

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(width)));
}

/** A stored width clamped to the allowed range; anything that is not a whole number falls back to the default. */
export function parseSidebarWidth(value: string | undefined): number {
  return value && /^\d{1,6}$/.test(value) ? clampSidebarWidth(Number(value)) : SIDEBAR_WIDTH.default;
}

export function parseSidebarHidden(value: string | undefined): boolean {
  return value === SIDEBAR_HIDDEN;
}
