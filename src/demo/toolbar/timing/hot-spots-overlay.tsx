"use client";

import { useActivity } from "../../runtime/runtime-context";
import { regionElements, useTrackedRects } from "../geometry";
import { hotSpots } from "./timing";
import { useTiming } from "./timing-state";
import styles from "./timing.module.css";

/** Hot spots on the page: each region tinted by its cost, the costliest strongest. */
export function HotSpotsOverlay() {
  const timing = useTiming();
  const { loads } = useActivity();
  const rects = useTrackedRects(() => regionElements(), timing.hotSpots);
  if (!timing.hotSpots) return null;
  const spots = hotSpots([...rects.keys()], loads, timing.interactions);
  return (
    <div className={styles.layer} data-overlay="" aria-hidden="true">
      {spots.map((spot, index) => {
        const rect = rects.get(spot.member);
        if (!rect) return null;
        return (
          <div key={spot.member} className={styles.tint} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} data-level={spot.level} data-hot-spot-tint={spot.member}>
            <span className={styles.tintLabel}>{`#${index + 1} · ${Math.round(spot.costMs).toLocaleString("en-US")} ms`}</span>
          </div>
        );
      })}
    </div>
  );
}
