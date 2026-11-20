"use client";

import { Placed } from "@/components/toolbar/placed";
import styles from "@/components/toolbar/timing/timing.module.css";
import { registryOf } from "../inspector/protocol";
import { type TargetDocument, useTargetDocument, useTargetRects } from "../target-document";
import { type HotSpot, findHotSpot, hotSpotLabel } from "./hot-spots";
import { useTiming } from "./timing-state";

/** The element of +spot+ in the frame now, or null when it isn't on this page. */
export function hotSpotElement(spot: HotSpot, target: Pick<TargetDocument, "window" | "document" | "route">): Element | null {
  const registry = registryOf(target.window);
  return findHotSpot<Element>(spot, target.route, (id) => registry?.elements.get(id)?.deref(), target.document);
}

/** Where each of +spots+ that's on the page now is, by key, while +active+, following the page as it changes. */
export function useHotSpotRects(spots: readonly HotSpot[], active: boolean) {
  const target = useTargetDocument();
  return useTargetRects(
    () => {
      const elements = new Map<string, Element>();
      for (const spot of spots) {
        const element = hotSpotElement(spot, target);
        if (element) elements.set(spot.key, element);
      }
      return elements;
    },
    active,
    `${spots.map((spot) => `${spot.key}:${spot.rank}:${spot.interactionIds[0]}`).join(",")}|${target.route}|${target.changes}`,
  );
}

/**
 * Hot spots on the page (restore-toolbar-tools-and-branch-previews, design
 * decision 10): each element behind a slow interaction on the route shown,
 * outlined in its rating's color and labeled with its rank, its slowest
 * time, and its rating. The outlines follow their elements, sit beneath the
 * toolbar's controls, and never take the page's pointer events. The selected
 * hot spot is highlighted.
 */
export function HotSpotsOverlay() {
  const timing = useTiming();
  const target = useTargetDocument();
  const spots = timing.hotSpots.filter((spot) => spot.route === target.route);
  const active = timing.showHotSpots && spots.length > 0;
  const rects = useHotSpotRects(spots, active);
  if (!active) return null;
  return (
    <div className={styles.layer} data-overlay="" aria-hidden="true">
      {spots.map((spot) => {
        const rect = rects.get(spot.key);
        if (!rect) return null;
        return (
          <div key={spot.key} className={styles.spotOutline} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} data-rating={spot.rating} data-highlighted={timing.selectedHotSpot === spot.key || undefined} data-hot-spot-outline={spot.rank}>
            <Placed follow preferred={(size) => ({ top: rect.top - size.height, left: rect.left })} className={styles.spotLabel} data-rating={spot.rating}>
              {hotSpotLabel(spot)}
            </Placed>
          </div>
        );
      })}
    </div>
  );
}
