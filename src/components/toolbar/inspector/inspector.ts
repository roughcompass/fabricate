import { type Metric, onCLS, onFCP, onLCP, onTTFB } from "web-vitals";
import { INSPECTOR_MESSAGE, type InspectedInteraction, type InspectedLoad, type InspectorMessage, type MeasuredVital, isToolbarEvent } from "./protocol";

/*
 * The timing inspector (add-applications, design decision 6). The toolbar
 * adds this script to a running application's framed page on each load, so it
 * runs in the page's own realm and measures the page itself, then reports to
 * the toolbar in the parent page (protocol.ts):
 *
 * - Web Vitals: LCP, CLS, FCP, and TTFB, from Google's web-vitals library,
 *   with every change reported. The library reads buffered entries, so a load
 *   that finished before the script arrived is still measured. INP is left to
 *   the toolbar, which counts only the application's interactions.
 * - Load order: the scripts, stylesheets, and remote entries the page fetched,
 *   from Resource Timing, buffered entries first, then each later one.
 * - Interactions: each click, tap, or key press, timed from input to the next
 *   paint with the Event Timing API. Without it, and for interactions too
 *   quick for it to report (under 16 ms), the time is approximate: from the
 *   input to the next frame after its handlers. An event the toolbar acted on
 *   is never recorded.
 *
 * Built into public/toolbar/inspector.js by scripts/build-inspector.ts.
 */

const INSTALLED = Symbol.for("frontend-registry.inspector");
/** Interactions waiting for their Event Timing entries. */
const DRAFT_LIMIT = 50;
/** The files a load-order row is about; anything else the page fetched, such as data and images, is left out. */
const LOAD_FILE = /\.(m?js|cjs|css)(\?|#|$)/i;
const LOAD_INITIATORS = new Set(["script", "link", "css", "other"]);

type Global = typeof globalThis & { [INSTALLED]?: true };
/** A message as written here: its type tag is added when it's posted. */
type Untagged = InspectorMessage extends infer Message ? (Message extends unknown ? Omit<Message, "type"> : never) : never;

function post(message: Untagged): void {
  window.parent.postMessage({ type: INSPECTOR_MESSAGE, ...message }, window.location.origin);
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** A person-readable name for the element an interaction targeted: its control's tag and name, or its id. */
function describeTarget(target: Element): string {
  const control = target.closest("button, a, input, select, textarea, summary, [role='button'], [role='link'], [role='tab'], [role='menuitem']") ?? target;
  const tag = control.tagName.toLowerCase();
  const name = (control.getAttribute("aria-label") || control.textContent || control.getAttribute("placeholder") || control.getAttribute("title") || "").replace(/\s+/g, " ").trim();
  if (name) return `${tag} "${truncate(name, 40)}"`;
  return control.id ? `${tag}#${control.id}` : tag;
}

function supportsEventTiming(): boolean {
  return typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes ?? []).includes("event");
}

function reportVitals(): void {
  const report = (metric: Metric) => post({ kind: "vital", name: metric.name as MeasuredVital, value: metric.value, rating: metric.rating });
  const options = { reportAllChanges: true };
  onLCP(report, options);
  onCLS(report, options);
  onFCP(report, options);
  onTTFB(report, options);
}

function reportLoads(self: string | null): void {
  if (typeof PerformanceObserver === "undefined" || !(PerformanceObserver.supportedEntryTypes ?? []).includes("resource")) return;
  const send = (entries: readonly PerformanceEntry[]) => {
    const loads = (entries as readonly PerformanceResourceTiming[])
      .filter((entry) => entry.name !== self && LOAD_INITIATORS.has(entry.initiatorType) && (LOAD_FILE.test(entry.name) || /remoteEntry/i.test(entry.name)))
      .map((entry): InspectedLoad => ({ url: entry.name, initiator: entry.initiatorType, startMs: entry.startTime, durationMs: entry.duration }));
    if (loads.length) post({ kind: "loads", loads });
  };
  new PerformanceObserver((list) => send(list.getEntries())).observe({ type: "resource", buffered: true });
}

interface Draft {
  readonly id: number;
  readonly event: Event;
  readonly kind: InspectedInteraction["kind"];
  readonly target: string;
  readonly pathname: string;
  readonly start: number;
  readonly eventName: "click" | "keydown";
  fallbackMs: number | null;
  exactMs: number | null;
}

function reportInteractions(eventTiming: boolean): void {
  const drafts: Draft[] = [];
  const byInteraction = new Map<number, Draft>();
  // Entries for an interaction's other events (pointerdown, keyup) can arrive before its click or keydown.
  const unmatched = new Map<number, number>();
  let nextId = 1;

  const commit = (draft: Draft) => {
    if (isToolbarEvent(draft.event)) return;
    post({
      kind: "interaction",
      interaction: { id: draft.id, kind: draft.kind, target: draft.target, pathname: draft.pathname, durationMs: draft.exactMs ?? draft.fallbackMs ?? 0, approximate: draft.exactMs === null },
    });
  };

  const onInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const eventName = event.type === "keydown" ? "keydown" : "click";
    // A click that Enter or Space fires belongs to that key press, which is already recorded.
    if (eventName === "click" && (event as MouseEvent).detail === 0 && !(event as PointerEvent).pointerType) return;
    const kind: InspectedInteraction["kind"] = eventName === "keydown" ? "Key press" : (event as PointerEvent).pointerType === "touch" ? "Tap" : "Click";
    const draft: Draft = { id: nextId++, event, kind, target: describeTarget(target), pathname: window.location.pathname, start: event.timeStamp, eventName, fallbackMs: null, exactMs: null };
    drafts.push(draft);
    if (drafts.length > DRAFT_LIMIT) drafts.shift();
    // The handlers run after this capture listener; the frame after them is the fallback's paint.
    window.requestAnimationFrame(() =>
      window.setTimeout(() => {
        draft.fallbackMs = performance.now() - draft.start;
        commit(draft);
      }, 0),
    );
  };

  if (eventTiming) {
    new PerformanceObserver((list) => {
      const entries = list.getEntries() as PerformanceEventTiming[];
      for (const entry of entries) {
        if (!entry.interactionId || byInteraction.has(entry.interactionId)) continue;
        const draft = drafts.find((candidate) => candidate.eventName === entry.name && Math.abs(candidate.start - entry.startTime) < 1);
        if (draft) byInteraction.set(entry.interactionId, draft);
      }
      for (const entry of entries) {
        if (!entry.interactionId) continue;
        const draft = byInteraction.get(entry.interactionId);
        if (!draft) {
          unmatched.set(entry.interactionId, Math.max(unmatched.get(entry.interactionId) ?? 0, entry.duration));
          continue;
        }
        draft.exactMs = Math.max(draft.exactMs ?? 0, entry.duration, unmatched.get(entry.interactionId) ?? 0);
        unmatched.delete(entry.interactionId);
        commit(draft);
      }
    }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  }

  // On the window, so they run before any listener of the page's own.
  window.addEventListener("click", onInput, true);
  window.addEventListener("keydown", onInput, true);
}

function install(): void {
  const global = globalThis as Global;
  // Once per page, and only inside a frame, where there's a toolbar to report to.
  if (global[INSTALLED] || window.parent === window) return;
  global[INSTALLED] = true;
  const self = document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : null;
  const eventTiming = supportsEventTiming();
  post({ kind: "ready", eventTiming });
  reportVitals();
  reportLoads(self);
  reportInteractions(eventTiming);
}

install();
