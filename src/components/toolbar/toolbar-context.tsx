"use client";

import { createContext, use } from "react";
import type { IconName } from "@/components/ui/icon";

/** The tools that open a panel. Comment is a mode, and Hide toolbar a command; neither has a panel. */
export const TOOLS = ["comments", "share", "microfrontends", "accessibility", "timing", "session", "settings", "shortcuts"] as const;
export type ToolId = (typeof TOOLS)[number];

/** A mode that changes what pointer and keyboard do on the page. */
export type ToolbarMode = "none" | "comment" | "select";

export const ITEM_GROUPS = ["Collaboration", "Inspect", "Runtime", "More"] as const;
export type ItemGroup = (typeof ITEM_GROUPS)[number];

export type ItemAction = { readonly kind: "tool"; readonly tool: ToolId } | { readonly kind: "mode"; readonly mode: "comment" } | { readonly kind: "command"; readonly command: "hide" };

export interface ToolbarItem {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  readonly group: ItemGroup;
  /** A fixed single-key shortcut. */
  readonly key?: string;
  /** Other words the menu's search matches. */
  readonly aliases: readonly string[];
  readonly action: ItemAction;
  /** Whether the menu's Shortcuts row offers it. */
  readonly shortcutRow: boolean;
}

/**
 * Every toolbar item (design.md, decision 4). One model drives the pill, the
 * menu and its Shortcuts row, the tooltips, the keyboard shortcuts, the
 * shortcuts reference, and the guided hints, so they can never disagree.
 */
export const TOOLBAR_ITEMS: readonly ToolbarItem[] = [
  { id: "comment", name: "Comment", icon: "message", group: "Collaboration", key: "c", aliases: ["annotate", "feedback", "pin", "note"], action: { kind: "mode", mode: "comment" }, shortcutRow: true },
  { id: "comments", name: "Comments", icon: "inbox", group: "Collaboration", aliases: ["threads", "inbox", "discussion", "replies"], action: { kind: "tool", tool: "comments" }, shortcutRow: false },
  { id: "share", name: "Share", icon: "link", group: "Collaboration", key: "l", aliases: ["link", "invite", "copy", "send"], action: { kind: "tool", tool: "share" }, shortcutRow: true },
  { id: "microfrontends", name: "Microfrontends", icon: "layers", group: "Inspect", key: "m", aliases: ["mfe", "zones", "versions", "routing", "override"], action: { kind: "tool", tool: "microfrontends" }, shortcutRow: true },
  { id: "accessibility", name: "Accessibility", icon: "accessibility", group: "Inspect", key: "a", aliases: ["a11y", "audit", "axe", "wcag"], action: { kind: "tool", tool: "accessibility" }, shortcutRow: true },
  { id: "timing", name: "Timing", icon: "clock", group: "Inspect", key: "t", aliases: ["performance", "inp", "hot spots", "waterfall", "speed"], action: { kind: "tool", tool: "timing" }, shortcutRow: true },
  { id: "session", name: "Session", icon: "user", group: "Runtime", key: "p", aliases: ["persona", "profile", "role", "user", "sign in"], action: { kind: "tool", tool: "session" }, shortcutRow: true },
  { id: "settings", name: "Settings", icon: "settings", group: "Runtime", key: "s", aliases: ["theme", "dark", "bus", "events", "publish"], action: { kind: "tool", tool: "settings" }, shortcutRow: true },
  { id: "shortcuts", name: "Keyboard shortcuts", icon: "keyboard", group: "More", key: "?", aliases: ["keys", "hotkeys", "preferences"], action: { kind: "tool", tool: "shortcuts" }, shortcutRow: false },
  { id: "hide", name: "Hide toolbar", icon: "eyeOff", group: "More", key: ".", aliases: ["collapse", "minimize", "close"], action: { kind: "command", command: "hide" }, shortcutRow: false },
];

export function itemById(id: string): ToolbarItem | undefined {
  return TOOLBAR_ITEMS.find((item) => item.id === id);
}

/** The item a key press opens, if any; letters ignore case. */
export function itemForKey(key: string): ToolbarItem | undefined {
  const pressed = key.length === 1 ? key.toLowerCase() : key;
  return TOOLBAR_ITEMS.find((item) => item.key === pressed);
}

/** The items whose name or aliases contain the query, ignoring case; every item for an empty query. */
export function matchItems(query: string, items: readonly ToolbarItem[] = TOOLBAR_ITEMS): ToolbarItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => [item.name, ...item.aliases].some((text) => text.toLowerCase().includes(needle)));
}

/** A key as the toolbar shows it on a key chip. */
export function keyLabel(key: string): string {
  return key.length === 1 && /[a-z]/.test(key) ? key.toUpperCase() : key;
}

/** The item the pill shows while a tool's panel is open or a mode is active. */
export function activeItemFor(tool: ToolId | null, mode: ToolbarMode): ToolbarItem | null {
  if (mode === "comment") return itemById("comment")!;
  if (mode === "select") return itemById("microfrontends")!;
  return tool ? (TOOLBAR_ITEMS.find((item) => item.action.kind === "tool" && item.action.tool === tool) ?? null) : null;
}

export interface ToolbarApi {
  readonly tool: ToolId | null;
  /** Opens a panel; focus returns to `opener` (or what had focus) when it closes. */
  openTool(tool: ToolId, opener?: HTMLElement | null): void;
  closeTool(): void;
  readonly mode: ToolbarMode;
  setMode(mode: ToolbarMode): void;
  readonly menuOpen: boolean;
  /** Opens the menu, optionally with an item highlighted. */
  openMenu(highlight?: string): void;
  closeMenu(): void;
  /** The tool or mode the pill shows as active. */
  readonly activeItem: ToolbarItem | null;
  /** Runs an item's action, as choosing it in the menu does. */
  runItem(item: ToolbarItem, opener?: HTMLElement | null): void;
  /**
   * Space, in pixels, the open menu leaves free below itself for a guided hint
   * that points into it, when nothing beside the menu is free; 0 for none.
   */
  setMenuRoom(room: number): void;
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
