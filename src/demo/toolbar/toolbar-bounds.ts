"use client";

import { useSyncExternalStore } from "react";
import type { Rect } from "./placement";

/**
 * Where the toolbar's controls are: the pill or its tab, the menu, and the
 * open panel (design.md, decision 2). Floating overlays read these rectangles
 * to stay clear of the controls. The controls are fixed to the viewport, so
 * their rectangles change only when a control changes size or the window does.
 */

const elements = new Map<string, Element>();
const listeners = new Set<() => void>();
let rects: readonly Rect[] = [];
let observer: ResizeObserver | null = null;
let listening = false;
const EMPTY: readonly Rect[] = [];

function same(a: readonly Rect[], b: readonly Rect[]): boolean {
  return a.length === b.length && a.every((rect, index) => rect.top === b[index]!.top && rect.left === b[index]!.left && rect.width === b[index]!.width && rect.height === b[index]!.height);
}

function measure() {
  const next = [...elements.values()]
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0)
    .map((box) => ({ top: box.top, left: box.left, width: box.width, height: box.height }));
  if (same(next, rects)) return;
  rects = next;
  for (const listener of listeners) listener();
}

/** Registers a control's element under a key, or removes it when `element` is null. */
export function trackToolbarBound(key: string, element: Element | null): void {
  if (typeof window === "undefined") return;
  observer ??= new ResizeObserver(() => measure());
  const previous = elements.get(key);
  if (previous === element) return;
  if (previous) observer.unobserve(previous);
  if (element) {
    elements.set(key, element);
    observer.observe(element);
  } else elements.delete(key);
  if (!listening) {
    window.addEventListener("resize", measure);
    listening = true;
  }
  // Position can change with a sibling's size, as when the pill grows; measure once layout settles.
  window.requestAnimationFrame(measure);
}

/** Re-measures now, for a change that moved a control without resizing it. */
export function remeasureToolbarBounds(): void {
  if (typeof window !== "undefined") measure();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The toolbar controls' rectangles, in viewport coordinates. */
export function useToolbarBounds(): readonly Rect[] {
  return useSyncExternalStore(subscribe, () => rects, () => EMPTY);
}

/** A ref callback that tracks an element as a toolbar bound. */
export function boundRef(key: string): (element: Element | null) => void {
  return (element) => trackToolbarBound(key, element);
}
