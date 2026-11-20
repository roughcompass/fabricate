"use client";

import { createContext, use } from "react";
import type { BuildComposition } from "@/lib/applications/composition";

/**
 * The view a running application's toolbar is over: the application, the
 * saved preview shown if any, and what the Profile of the build's commit
 * says it's composed of. Tools that keep choices in the browser, such as the
 * theme, keep them by the view's key.
 */
export interface ToolbarView {
  readonly slug: string;
  readonly name: string;
  /** The saved preview shown, by its key; null for the application's tracked branch. */
  readonly preview: string | null;
  /** The view's key among those the browser keeps: `<slug>`, or `<slug>@<key>` for a saved preview. */
  readonly key: string;
  readonly composition: BuildComposition;
}

export const ToolbarViewContext = createContext<ToolbarView | null>(null);

export function useToolbarView(): ToolbarView {
  const view = use(ToolbarViewContext);
  if (!view) throw new Error("useToolbarView must be used inside a running application's toolbar");
  return view;
}

/** A view's key: the application's slug, with the saved preview's key after an `@`. */
export function viewKey(slug: string, preview: string | null): string {
  return preview ? `${slug}@${preview}` : slug;
}
