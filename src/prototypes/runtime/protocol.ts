import type { AuditViolation, NotedElement, Scope, ShellConfig } from "@/lib/prototypes/types";

/**
 * What the render route tells the frame (design.md, decision 8), as JSON in
 * the frame's own document, never as code. The frame has an opaque origin, so
 * it reaches DE FabLab only through the typed messages below.
 */
export interface RenderConfig {
  readonly scope: Scope;
  readonly mode: "light" | "dark";
  readonly density: Density;
  /** The page shell, with the current navigation item and the signed-in user; null for component scope. */
  readonly shell: { readonly config: ShellConfig; readonly current: string | null; readonly user: { readonly name: string; readonly role: string } } | null;
  readonly title: string;
  /** Who is signed in: the version's first persona. The in-frame `@deweb/portal` profile is made from it. */
  readonly user: { readonly name: string; readonly role: string };
  /** The page that embeds the frame, the only origin messages go to. */
  readonly parentOrigin: string;
}

export const DENSITIES = ["high", "medium", "low", "touch"] as const;
export type Density = (typeof DENSITIES)[number];

/** The id of the JSON script element that carries the RenderConfig. */
export const RENDER_CONFIG_ID = "fabricate-render-config";

/** The global a compiled version registers its component on. */
export const PROTOTYPE_GLOBAL = "__fabricatePrototype";

const TAG = "fabricate-prototype";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PinPlacement {
  readonly id: string;
  /** Null when the element can't be found in this render. */
  readonly rect: Rect | null;
}

/** Messages from the frame to the page. */
export type FrameMessage =
  | { readonly type: "ready"; readonly height: number }
  | { readonly type: "render-error"; readonly message: string }
  | { readonly type: "audit-result"; readonly violations: readonly AuditViolation[] }
  | { readonly type: "audit-error"; readonly message: string }
  | { readonly type: "element-selected"; readonly element: NotedElement }
  | { readonly type: "capture-result"; readonly dataUrl: string }
  | { readonly type: "capture-error"; readonly message: string }
  | { readonly type: "pins"; readonly pins: readonly PinPlacement[] }
  | { readonly type: "comment-mode"; readonly on: boolean };

/** Messages from the page to the frame. */
export type PageMessage =
  | { readonly type: "run-audit" }
  | { readonly type: "set-comment-mode"; readonly on: boolean }
  | { readonly type: "set-pins"; readonly pins: readonly { readonly id: string; readonly locator: string; readonly label: string }[] }
  | { readonly type: "highlight"; readonly selectors: readonly string[] }
  | { readonly type: "capture"; readonly width: number; readonly height: number };

export function envelope<T extends FrameMessage | PageMessage>(message: T): T & { readonly tag: typeof TAG } {
  return { ...message, tag: TAG };
}

/** The message if `data` is one of ours, otherwise null. Anything else posted to the window is ignored. */
export function readMessage<T extends FrameMessage | PageMessage>(data: unknown, types: readonly T["type"][]): T | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as { tag?: unknown; type?: unknown };
  if (record.tag !== TAG || typeof record.type !== "string" || !types.includes(record.type as T["type"])) return null;
  return data as T;
}

export const FRAME_MESSAGE_TYPES = ["ready", "render-error", "audit-result", "audit-error", "element-selected", "capture-result", "capture-error", "pins", "comment-mode"] as const satisfies readonly FrameMessage["type"][];
export const PAGE_MESSAGE_TYPES = ["run-audit", "set-comment-mode", "set-pins", "highlight", "capture"] as const satisfies readonly PageMessage["type"][];
