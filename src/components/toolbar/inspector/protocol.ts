import type { ElementAnchor } from "../comments/element-anchor";

/**
 * What the frame agent (inspector.ts) reports from a framed application to
 * the toolbar around it (add-applications, design decision 6;
 * restore-toolbar-tools-and-branch-previews, design decision 6). The agent
 * runs in the frame's own realm and posts these messages to its parent; the
 * toolbar accepts them only from its frame's window, on its own origin.
 * Plain data only, so they cross realms intact.
 */

/** Tags every message, so the toolbar can tell the agent's from the application's own. */
export const INSPECTOR_MESSAGE = "frontend-registry:inspector";

/** Where the Frontend Registry serves the agent's bundle (public/toolbar/inspector.js, built by scripts/build-inspector.ts). */
export const INSPECTOR_SCRIPT = "/toolbar/inspector.js";

/** Where it serves axe-core, which the Accessibility tool adds to a running application's page (src/app/toolbar/axe.js). */
export const AXE_SCRIPT = "/toolbar/axe.js";

/**
 * The property the toolbar sets on an event it acted on, such as one of its
 * shortcuts or a click that chose an element to comment on, so the agent
 * doesn't record it as the application's. `Symbol.for` keys are shared by
 * every realm, so the frame's events carry it to the agent.
 */
export const TOOLBAR_EVENT = Symbol.for("frontend-registry.toolbar-event");

/**
 * The global, in the frame's realm, where the agent keeps what the toolbar
 * reads directly rather than through messages: its page's id, and the
 * element behind each interaction, by the interaction's id, held weakly so
 * the page can let it go. The toolbar shares the frame's origin, so it reads
 * them through the frame's window.
 */
export const INSPECTOR_REGISTRY = Symbol.for("frontend-registry.inspector");

export interface InspectorRegistry {
  /** Unique to this load of the page: every message the agent posts carries it. */
  readonly page: string;
  readonly elements: Map<number, WeakRef<Element>>;
}

export type Rating = "good" | "needs-improvement" | "poor";
export type MeasuredVital = "LCP" | "CLS" | "FCP" | "TTFB";
export type InteractionKind = "Click" | "Tap" | "Key press";

export interface InspectedInteraction {
  /** Numbered from 1 in the page; a later report with the same id replaces the earlier, as an exact time replaces an approximate one. */
  readonly id: number;
  readonly kind: InteractionKind;
  /** The element the visitor used, described for people: `button "Recalculate totals"`. */
  readonly target: string;
  /** Where that element is in the page, so it can be found again after a re-render; null when it couldn't be described. */
  readonly anchor: ElementAnchor | null;
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

/** A Module Federation runtime instance on the page (`globalThis.__FEDERATION__`), with the remotes it knows. */
export interface InspectedFederation {
  readonly name: string;
  readonly remotes: readonly { readonly name: string; readonly alias: string | null; readonly entry: string | null }[];
}

/** A request for a script or manifest the page made, from Resource Timing: status 0 when the browser doesn't expose it, or the request failed. */
export interface InspectedRequest {
  readonly url: string;
  readonly initiator: string;
  readonly status: number;
}

/** An import map on the page, native or SystemJS, with its entries; an external one by its address. */
export interface InspectedImportMap {
  readonly type: "importmap" | "systemjs-importmap";
  readonly imports: Readonly<Record<string, string>>;
  readonly src: string | null;
}

/** What the page shows it's composed of at run time. */
export interface InspectedComposition {
  readonly federation: readonly InspectedFederation[];
  /** Window globals that are Module Federation containers: an object with `get` and `init`. */
  readonly containers: readonly string[];
  readonly requests: readonly InspectedRequest[];
  /** Addresses of scripts and stylesheets whose element reported an error. */
  readonly failed: readonly string[];
  readonly importMaps: readonly InspectedImportMap[];
  /** Single-spa applications whose container (`id="single-spa-application:<name>"`) is on the page, by name. */
  readonly regions: readonly string[];
}

/** Where an event bus entry was seen. */
export type BusKind = "window" | "document" | "message" | "posted";

/** One entry of the page's event bus. */
export interface BusEntry {
  /** Numbered from 1 in the page. */
  readonly id: number;
  readonly kind: BusKind;
  /** The event's type; a message's is `message`. */
  readonly name: string;
  /** From the start of the page's navigation. */
  readonly timeMs: number;
  /** The event's detail, or the message's data, as JSON text, shortened when it's long. */
  readonly detail: string;
  readonly from: "application" | "toolbar";
}

/** Where a WebSocket connection is: opening, open, closed after it opened, or failed before it did. */
export type SocketState = "connecting" | "open" | "closed" | "failed";

/** A WebSocket connection the page opened, by its address; its messages are never reported. */
export interface InspectedSocket {
  /** Numbered from 1 in the page; a later report with the same id replaces the earlier. */
  readonly id: number;
  readonly url: string;
  readonly state: SocketState;
}

/** A service worker the page registered, with its script and scope, absolute. */
export interface InspectedRegistration {
  readonly script: string;
  readonly scope: string;
}

type Tagged<M> = { readonly type: typeof INSPECTOR_MESSAGE; readonly page: string } & M;

export type InspectorMessage =
  | Tagged<{ readonly kind: "ready"; readonly eventTiming: boolean }>
  | Tagged<{ readonly kind: "vital"; readonly name: MeasuredVital; readonly value: number; readonly rating: Rating }>
  | Tagged<{ readonly kind: "interaction"; readonly interaction: InspectedInteraction }>
  | Tagged<{ readonly kind: "loads"; readonly loads: readonly InspectedLoad[] }>
  | Tagged<{ readonly kind: "composition"; readonly composition: InspectedComposition }>
  | Tagged<{ readonly kind: "bus"; readonly entry: BusEntry }>
  | Tagged<{ readonly kind: "websocket"; readonly socket: InspectedSocket }>
  | Tagged<{ readonly kind: "service-worker"; readonly registration: InspectedRegistration }>;

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

/** The agent's registry in +view+'s realm, once the agent runs there. */
export function registryOf(view: Window | null): InspectorRegistry | null {
  try {
    const registry = (view as (Window & { [INSPECTOR_REGISTRY]?: InspectorRegistry }) | null)?.[INSPECTOR_REGISTRY];
    return registry && typeof registry.page === "string" ? registry : null;
  } catch {
    return null;
  }
}
