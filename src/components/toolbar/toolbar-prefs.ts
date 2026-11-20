"use client";

import { useSyncExternalStore } from "react";
import { DEMO_STORAGE_PREFIX, readDemoItem } from "@/lib/web/demo-storage";

/**
 * The visitor's toolbar preferences, kept in the browser across every running
 * application: whether the toolbar is collapsed, and whether single-key
 * shortcuts are on (WCAG 2.1.4 requires a way to turn them off). Preferences
 * the template demo stored that nothing reads now, such as `zoneIndicator`
 * and `debug`, are ignored, and dropped the next time the preferences are
 * saved.
 */

export interface ToolbarPrefs {
  readonly collapsed: boolean;
  readonly shortcuts: boolean;
}

const KEY = `${DEMO_STORAGE_PREFIX}:toolbar`;
const DEFAULTS: ToolbarPrefs = { collapsed: false, shortcuts: true };

const listeners = new Set<() => void>();
let current: ToolbarPrefs | null = null;

/**
 * The preferences stored as +stored+, JSON or nothing: the ones the toolbar
 * reads, with anything else left out, and the defaults when it can't be read.
 * @public Its tests read stored preferences through it.
 */
export function parseToolbarPrefs(stored: string | null): ToolbarPrefs {
  try {
    const raw = JSON.parse(stored ?? "{}") as Partial<Record<keyof ToolbarPrefs, unknown>> | null;
    return { collapsed: raw?.collapsed === true, shortcuts: raw?.shortcuts !== false };
  } catch {
    return DEFAULTS;
  }
}

function read(): ToolbarPrefs {
  if (current) return current;
  try {
    current = parseToolbarPrefs(readDemoItem(window.localStorage, KEY));
  } catch {
    current = DEFAULTS;
  }
  return current;
}

export function setToolbarPrefs(change: Partial<ToolbarPrefs>): void {
  current = { ...read(), ...change };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Without storage the preference lasts for this page only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToolbarPrefs(): ToolbarPrefs {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
