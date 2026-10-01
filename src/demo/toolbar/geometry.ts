"use client";

import { useEffect, useEffectEvent, useState } from "react";

/**
 * Where page elements are on screen, for the toolbar's overlays: region
 * outlines, debug labels, audit outlines, comment pins, and hot spots. Rects
 * are viewport coordinates, recomputed on scroll, resize, and DOM changes,
 * at most once per animation frame.
 */

export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/**
 * Tracks the rects of the elements `collect` returns, by key, while `active`.
 * Change `revision` whenever `collect` would return different elements.
 */
export function useTrackedRects<K extends string>(collect: () => ReadonlyMap<K, Element>, active: boolean, revision: unknown = null): ReadonlyMap<K, Rect> {
  const [rects, setRects] = useState<ReadonlyMap<K, Rect>>(() => new Map());
  const measure = useEffectEvent(() => {
    const next = new Map<K, Rect>();
    for (const [key, element] of collect()) next.set(key, rectOf(element));
    setRects(next);
  });

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    schedule();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-demo-state", "data-demo-version", "class", "style"] });
    const sizes = new ResizeObserver(schedule);
    sizes.observe(document.body);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      mutations.disconnect();
      sizes.disconnect();
    };
  }, [active, revision]);

  return active ? rects : EMPTY;
}

const EMPTY = new Map<never, Rect>();

/** The microfrontend regions on the page, by member. */
export function regionElements(): ReadonlyMap<string, Element> {
  return new Map([...document.querySelectorAll("[data-demo-mfe]")].map((element) => [element.getAttribute("data-demo-mfe")!, element]));
}

/** The member a page element belongs to: its region, or the portal shell around the regions. */
export function memberOf(element: Element | null, shell: string): string | null {
  if (!element || element.closest("[data-demo-toolbar]")) return null;
  const region = element.closest("[data-demo-mfe]");
  if (region) return region.getAttribute("data-demo-mfe");
  return element.closest("[data-demo-portal]") ? shell : null;
}
