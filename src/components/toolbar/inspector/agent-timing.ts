import { type Metric, onCLS, onFCP, onLCP, onTTFB } from "web-vitals";
import { anchorFor, commentTarget } from "../comments/element-anchor";
import { type Post, truncate } from "./agent-post";
import { INSPECTOR_SCRIPT, type InspectedInteraction, type InspectedLoad, type MeasuredVital, isToolbarEvent } from "./protocol";

/*
 * The agent's timing and hot spots modules:
 *
 * - Web Vitals: LCP, CLS, FCP, and TTFB, from Google's web-vitals library,
 *   with every change reported. The library reads buffered entries, so a load
 *   that finished before the agent arrived is still measured. INP is left to
 *   the toolbar, which counts only the application's interactions.
 * - Load order: the scripts, stylesheets, and remote entries the page fetched,
 *   from Resource Timing, buffered entries first, then each later one.
 * - Interactions: each click, tap, or key press, timed from input to the next
 *   paint with the Event Timing API. Without it, and for interactions too
 *   quick for it to report (under 16 ms), the time is approximate: from the
 *   input to the next frame after its handlers. An event the toolbar acted on
 *   is never recorded. Each carries an anchor of its element, and the
 *   element itself is kept, weakly, in the registry, for hot spots.
 */

/** Interactions waiting for their Event Timing entries. */
const DRAFT_LIMIT = 50;
/** Interactions whose elements are kept for hot spots. */
const ELEMENT_LIMIT = 1000;
/** The files a load-order row is about; anything else the page fetched, such as data and images, is left out. */
const LOAD_FILE = /\.(m?js|cjs|css)(\?|#|$)/i;
const LOAD_INITIATORS = new Set(["script", "link", "css", "other"]);

/** A person-readable name for the element an interaction targeted: its control's tag and name, or its id. */
function describeTarget(target: Element): string {
  const control = target.closest("button, a, input, select, textarea, summary, [role='button'], [role='link'], [role='tab'], [role='menuitem']") ?? target;
  const tag = control.tagName.toLowerCase();
  const name = (control.getAttribute("aria-label") || control.textContent || control.getAttribute("placeholder") || control.getAttribute("title") || "").replace(/\s+/g, " ").trim();
  if (name) return `${tag} "${truncate(name, 40)}"`;
  return control.id ? `${tag}#${control.id}` : tag;
}

export function supportsEventTiming(): boolean {
  return typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes ?? []).includes("event");
}

/** Whether the browser reports +type+ entries to a PerformanceObserver. */
export function observes(type: string): boolean {
  return typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes ?? []).includes(type);
}

export function reportVitals(post: Post): void {
  const report = (metric: Metric) => post({ kind: "vital", name: metric.name as MeasuredVital, value: metric.value, rating: metric.rating });
  const options = { reportAllChanges: true };
  onLCP(report, options);
  onCLS(report, options);
  onFCP(report, options);
  onTTFB(report, options);
}

export function reportLoads(post: Post): void {
  if (!observes("resource")) return;
  const own = new URL(INSPECTOR_SCRIPT, window.location.href).href;
  const send = (entries: readonly PerformanceEntry[]) => {
    const loads = (entries as readonly PerformanceResourceTiming[])
      .filter((entry) => entry.name !== own && LOAD_INITIATORS.has(entry.initiatorType) && (LOAD_FILE.test(entry.name) || /remoteEntry/i.test(entry.name)))
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
  readonly anchor: InspectedInteraction["anchor"];
  readonly pathname: string;
  readonly start: number;
  readonly eventName: "click" | "keydown";
  fallbackMs: number | null;
  exactMs: number | null;
}

/** The anchor of the element behind an interaction, or null when the page can't be described. */
function anchorOf(element: Element): InspectedInteraction["anchor"] {
  try {
    return anchorFor(element, document);
  } catch {
    return null;
  }
}

/** Times every interaction, keeping each one's element in +elements+ by its id. */
export function reportInteractions(post: Post, eventTiming: boolean, elements: Map<number, WeakRef<Element>>): void {
  const drafts: Draft[] = [];
  const byInteraction = new Map<number, Draft>();
  // Entries for an interaction's other events (pointerdown, keyup) can arrive before its click or keydown.
  const unmatched = new Map<number, number>();
  let nextId = 1;

  const commit = (draft: Draft) => {
    if (isToolbarEvent(draft.event)) {
      elements.delete(draft.id);
      return;
    }
    post({
      kind: "interaction",
      interaction: { id: draft.id, kind: draft.kind, target: draft.target, anchor: draft.anchor, pathname: draft.pathname, durationMs: draft.exactMs ?? draft.fallbackMs ?? 0, approximate: draft.exactMs === null },
    });
  };

  const onInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const eventName = event.type === "keydown" ? "keydown" : "click";
    // A click that Enter or Space fires belongs to that key press, which is already recorded.
    if (eventName === "click" && (event as MouseEvent).detail === 0 && !(event as PointerEvent).pointerType) return;
    const kind: InspectedInteraction["kind"] = eventName === "keydown" ? "Key press" : (event as PointerEvent).pointerType === "touch" ? "Tap" : "Click";
    const element = commentTarget(target);
    const draft: Draft = { id: nextId++, event, kind, target: describeTarget(target), anchor: anchorOf(element), pathname: window.location.pathname, start: event.timeStamp, eventName, fallbackMs: null, exactMs: null };
    elements.set(draft.id, new WeakRef(element));
    // As many as the toolbar keeps for a page.
    if (elements.size > ELEMENT_LIMIT) elements.delete(elements.keys().next().value!);
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
