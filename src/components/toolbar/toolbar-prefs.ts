"use client";

import { useSyncExternalStore } from "react";

/**
 * The visitor's toolbar preferences, kept in the browser across every running
 * application: whether the toolbar is collapsed, the zone indicator and
 * routing debug mode, and whether single-key shortcuts are on (WCAG 2.1.4
 * requires a way to turn them off).
 */

export interface ToolbarPrefs {
  readonly collapsed: boolean;
  readonly zoneIndicator: boolean;
  readonly debug: boolean;
  readonly shortcuts: boolean;
}

const KEY = "fabricate-demo:toolbar";
const DEFAULTS: ToolbarPrefs = { collapsed: false, zoneIndicator: false, debug: false, shortcuts: true };

const listeners = new Set<() => void>();
let current: ToolbarPrefs | null = null;

function read(): ToolbarPrefs {
  if (current) return current;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof ToolbarPrefs, unknown>>;
    current = {
      collapsed: raw.collapsed === true,
      zoneIndicator: raw.zoneIndicator === true,
      debug: raw.debug === true,
      shortcuts: raw.shortcuts !== false,
    };
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
