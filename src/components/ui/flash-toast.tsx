"use client";

import { useLayoutEffect } from "react";
import { StaticToast, type ToastAction, type ToastTone, useToast } from "./toast";
import { useHydrated } from "./use-hydrated";

export interface Outcome {
  /** Identifies the event, such as "added:src_abc". */
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: Pick<ToastAction, "label" | "href">;
}

/**
 * Shows an action's outcome once. The server renders it as a toast in the
 * toast position, so it is visible on first paint and without JavaScript; once
 * hydrated it hands over to the live toast and removes the outcome parameters
 * from the address, so a reload, Back, a background refresh, or a copied link
 * never shows it again.
 */
export function FlashToast({ outcome, strip }: { outcome: Outcome; strip: readonly string[] }) {
  const { toast } = useToast();
  const hydrated = useHydrated();

  useLayoutEffect(() => {
    toast(outcome);
    const url = new URL(window.location.href);
    for (const name of strip) url.searchParams.delete(name);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    // Runs once per outcome; the provider ignores a toast whose id is already showing.
  }, [outcome.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hydrated) return null;
  return <StaticToast toast={outcome} />;
}
