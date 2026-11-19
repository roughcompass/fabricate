/**
 * What the timing inspector (inspector.ts) reports from a framed application
 * to the toolbar around it (add-applications, design decision 6). The
 * inspector runs in the frame's own realm and posts these messages to its
 * parent; the toolbar accepts them only from its frame's window, on its own
 * origin. Plain data only, so they cross realms intact.
 */

/** Tags every message, so the toolbar can tell the inspector's from the application's own. */
export const INSPECTOR_MESSAGE = "frontend-registry:inspector";

/** Where the Frontend Registry serves the inspector's bundle (public/toolbar/inspector.js, built by scripts/build-inspector.ts). */
export const INSPECTOR_SCRIPT = "/toolbar/inspector.js";

/** Where it serves axe-core, which the Accessibility tool adds to a running application's page (src/app/toolbar/axe.js). */
export const AXE_SCRIPT = "/toolbar/axe.js";

/**
 * The property the toolbar sets on an event it acted on, such as one of its
 * shortcuts or a click that chose an element to comment on, so the inspector
 * doesn't record it as the application's. `Symbol.for` keys are shared by
 * every realm, so the frame's events carry it to the inspector.
 */
export const TOOLBAR_EVENT = Symbol.for("frontend-registry.toolbar-event");

export type Rating = "good" | "needs-improvement" | "poor";
export type MeasuredVital = "LCP" | "CLS" | "FCP" | "TTFB";
export type InteractionKind = "Click" | "Tap" | "Key press";

export interface InspectedInteraction {
  /** Numbered from 1 in the page; a later report with the same id replaces the earlier, as an exact time replaces an approximate one. */
  readonly id: number;
  readonly kind: InteractionKind;
  /** The element the visitor used, described for people: `button "Recalculate totals"`. */
  readonly target: string;
  /** The page's path when the interaction began. */
  readonly pathname: string;
  readonly durationMs: number;
  /** Measured to the next frame after the handlers, because the browser lacks Event Timing or reported none. */
  readonly approximate: boolean;
}

/** A script, stylesheet, or remote entry the page loaded, measured by the browser's Resource Timing. */
export interface InspectedLoad {
  readonly url: string;
  /** How the browser fetched it: `script`, `link`, `css`, and so on. */
  readonly initiator: string;
  /** From the start of the page's navigation. */
  readonly startMs: number;
  readonly durationMs: number;
}

export type InspectorMessage =
  | { readonly type: typeof INSPECTOR_MESSAGE; readonly kind: "ready"; readonly eventTiming: boolean }
  | { readonly type: typeof INSPECTOR_MESSAGE; readonly kind: "vital"; readonly name: MeasuredVital; readonly value: number; readonly rating: Rating }
  | { readonly type: typeof INSPECTOR_MESSAGE; readonly kind: "interaction"; readonly interaction: InspectedInteraction }
  | { readonly type: typeof INSPECTOR_MESSAGE; readonly kind: "loads"; readonly loads: readonly InspectedLoad[] };

export function isInspectorMessage(data: unknown): data is InspectorMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === INSPECTOR_MESSAGE;
}

/** Whether the toolbar acted on +event+. */
export function isToolbarEvent(event: Event): boolean {
  return (event as Event & { [TOOLBAR_EVENT]?: boolean })[TOOLBAR_EVENT] === true;
}

/** Marks +event+ as one the toolbar acted on, in whichever realm it was dispatched. */
export function markToolbarEvent(event: Event): void {
  (event as Event & { [TOOLBAR_EVENT]?: boolean })[TOOLBAR_EVENT] = true;
}
