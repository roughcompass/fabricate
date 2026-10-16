/** The Navigation section's addresses (navigation spec). */
export const NAVIGATION_HREF = "/navigation";

export const navigationCrumbs = [{ href: `${NAVIGATION_HREF}?portal=all`, label: "Navigation" }];

/** A Portal's Navigation page. */
export function navigationHref(portalPublicId: string): string {
  return `${NAVIGATION_HREF}/${portalPublicId}`;
}
