"use client";

import { type HTMLAttributes, useLayoutEffect, useRef, useState } from "react";
import { type Position, type Size, intersects, placeOutside } from "./placement";
import { useToolbarBounds } from "./toolbar-bounds";

/** Matches --space-3: the gap a corner overlay keeps from the viewport's edges. */
export const EDGE_GAP = 12;
/** Matches --space-6: the gap between a mode banner and the bottom of the viewport. */
export const BANNER_GAP = 24;

/** Where an overlay would go, given its own size and the viewport's. */
export type Preferred = (box: Size, viewport: Size) => Position;

export const topRight: Preferred = (box, viewport) => ({ top: EDGE_GAP, left: viewport.width - EDGE_GAP - box.width });
export const bottomCenter: Preferred = (box, viewport) => ({ top: viewport.height - BANNER_GAP - box.height, left: (viewport.width - box.width) / 2 });

interface Frame {
  readonly box: Size;
  readonly viewport: Size;
}

const sameFrame = (a: Frame, b: Frame) => a.box.width === b.box.width && a.box.height === b.box.height && a.viewport.width === b.viewport.width && a.viewport.height === b.viewport.height;

/**
 * A floating overlay placed clear of the toolbar's controls (template-demo/
 * toolbar spec: nothing overlays the toolbar). It measures itself, takes its
 * preferred position, and moves left of, above, or below any control it would
 * cover, within the viewport. An overlay that marks a page element (`follow`)
 * keeps its exact position, even off screen, unless it would cover a control.
 *
 * Its class must make it `position: fixed`, with no transformed ancestor.
 */
export function Placed({ preferred, follow = false, style, ...props }: { preferred: Preferred; follow?: boolean } & HTMLAttributes<HTMLDivElement>) {
  const element = useRef<HTMLDivElement>(null);
  const exclusions = useToolbarBounds();
  const [frame, setFrame] = useState<Frame | null>(null);

  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => {
      const next = { box: { width: node.offsetWidth, height: node.offsetHeight }, viewport: { width: document.documentElement.clientWidth, height: window.innerHeight } };
      setFrame((current) => (current && sameFrame(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  let position: Position | null = null;
  if (frame) {
    const wanted = preferred(frame.box, frame.viewport);
    const clear = !exclusions.some((exclusion) => intersects({ ...wanted, ...frame.box }, exclusion));
    position = follow && clear ? wanted : placeOutside(frame.box, wanted, exclusions, frame.viewport);
  }
  // Until it has measured itself, it stays transparent at the origin, where its natural size shows. Transparent, not
  // hidden, so a field inside can take focus on mount.
  return <div ref={element} {...props} style={{ ...style, ...(position ?? { top: 0, left: 0, opacity: 0 }) }} />;
}
