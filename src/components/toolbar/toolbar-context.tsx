"use client";

import { createContext, use } from "react";
import type { IconName } from "@/components/ui/icon";

export const TOOLS = ["comments", "microfrontends", "accessibility", "timing", "settings", "share"] as const;
export type ToolId = (typeof TOOLS)[number] | "shortcuts";

/** Each tool's button: its icon, accessible name, tooltip, and single-key shortcut. */
export const TOOL_BUTTONS: readonly { tool: Exclude<ToolId, "shortcuts">; icon: IconName; label: string; name: string; key: string }[] = [
  { tool: "comments", icon: "message", label: "Open comments", name: "Comments", key: "c" },
  { tool: "microfrontends", icon: "layers", label: "Open microfrontends", name: "Microfrontends", key: "m" },
  { tool: "accessibility", icon: "accessibility", label: "Open accessibility audit", name: "Accessibility", key: "a" },
  { tool: "timing", icon: "clock", label: "Open timing", name: "Timing", key: "t" },
  { tool: "settings", icon: "settings", label: "Open settings", name: "Settings", key: "s" },
  { tool: "share", icon: "link", label: "Open sharing", name: "Share", key: "l" },
];

/** A mode that changes what pointer and keyboard do on the page. */
export type ToolbarMode = "none" | "comment" | "select";

export interface ToolbarApi {
  readonly tool: ToolId | null;
  /** Opens a panel; focus returns to `opener` (or what had focus) when it closes. */
  openTool(tool: ToolId, opener?: HTMLElement | null): void;
  closeTool(): void;
  readonly mode: ToolbarMode;
  setMode(mode: ToolbarMode): void;
}

export const ToolbarContext = createContext<ToolbarApi | null>(null);

export function useToolbar(): ToolbarApi {
  const toolbar = use(ToolbarContext);
  if (!toolbar) throw new Error("useToolbar must be used inside the demo toolbar");
  return toolbar;
}

/** Whether a key press belongs to a text field, where single-key shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== "function") return false;
  return Boolean(element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}
