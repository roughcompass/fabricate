import type { PortalPlatform } from "./vocabulary";

/*
 * Choosing which "What's included" items show for a platform. The Create
 * Portal form filters as the platform changes, so this module imports
 * nothing that can't ship to the browser; whats-included.ts reads the file.
 */

export interface WhatsIncludedItem {
  title: string;
  description: string;
  badge?: "new";
  platforms?: PortalPlatform[];
}

/** The items shown while +platform+ is chosen: those without platforms, and those listing it. Before a platform is chosen, only the former. */
export function itemsFor<Item extends WhatsIncludedItem>(items: readonly Item[], platform: PortalPlatform | null): Item[] {
  return items.filter((item) => !item.platforms || (platform !== null && item.platforms.includes(platform)));
}
