"use client";

import { createContext, use, useEffect, useState, useSyncExternalStore } from "react";
import { isToolbarKey } from "@/components/toolbar/toolbar-context";
import { shellOf } from "@/lib/demo/catalog";
import { useRuntime } from "../../runtime/runtime-context";
import { memberOf } from "../geometry";
import { type Interaction, interactionToNextPaint } from "./timing";
import { type Vitals, getServerVitals, getVitals, subscribeVitals } from "./web-vitals";

/**
 * Interaction timing, recorded from the moment the application opens so the
 * tool has data whenever it is opened. Each click, tap, or key press in the
 * application (never the toolbar, nor a toolbar shortcut pressed there) is timed from input to the next paint with
 * the Event Timing API. Browsers without it get an approximate measure: from
 * the input to the next frame after its handlers finish, as do interactions
 * too quick for Event Timing to report (under 16 ms). The page load's Web
 * Vitals are recorded from the same moment; INP is computed here, from the
 * application's interactions alone, so using the toolbar never counts.
 */

interface TimingState {
  /** The latest interactions since the list was last cleared. */
  readonly interactions: readonly Interaction[];
  /** INP over every interaction since the page loaded; clearing the list keeps it. */
  readonly inpMs: number | null;
  readonly vitals: Vitals;
  readonly eventTiming: boolean;
  readonly hotSpots: boolean;
  setHotSpots(show: boolean): void;
  clear(): void;
}

const TimingContext = createContext<TimingState | null>(null);

export function useTiming(): TimingState {
  const timing = use(TimingContext);
  if (!timing) throw new Error("useTiming must be used inside the timing provider");
  return timing;
}

const LIMIT = 50;
// INP needs every interaction, not just the listed ones; this bounds a very long session.
const HISTORY_LIMIT = 1000;

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** A person-readable name for the element an interaction targeted; an unnamed one is told apart by its demo anchor. */
export function describeTarget(target: Element): string {
  const control = target.closest("button, a, input, select, textarea, [role='button'], [role='link'], [data-demo-anchor]") ?? target;
  const tag = control.tagName.toLowerCase();
  const name = (control.getAttribute("aria-label") || control.textContent || control.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim();
  if (name) return `${tag} "${truncate(name, 40)}"`;
  const anchor = control.getAttribute("data-demo-anchor");
  return anchor ? `${tag} (${anchor})` : tag;
}

interface Draft {
  id: number;
  event: Event;
  kind: Interaction["kind"];
  target: string;
  member: string;
  start: number;
  eventName: "click" | "keydown";
  fallbackMs: number | null;
  exactMs: number | null;
}

const subscribeNever = () => () => {};

// Ids run across the provider's lifetime, so an interaction cleared from the list is never confused with a later one.
let nextId = 1;

function supportsEventTiming(): boolean {
  return typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes ?? []).includes("event");
}

export function TimingProvider({ children }: { children: React.ReactNode }) {
  const { app } = useRuntime();
  const [history, setHistory] = useState<readonly Interaction[]>([]);
  // Interactions with an id at or below this were cleared from the list.
  const [clearedThrough, setClearedThrough] = useState(0);
  const eventTiming = useSyncExternalStore(subscribeNever, supportsEventTiming, () => false);
  const vitals = useSyncExternalStore(subscribeVitals, getVitals, getServerVitals);
  const [hotSpots, setHotSpots] = useState(false);
  const shell = shellOf(app).id;

  useEffect(() => {
    const drafts: Draft[] = [];
    const byInteraction = new Map<number, Draft>();
    // Entries for an interaction's other events (pointerdown, keyup) can arrive before its click or keydown.
    const unmatched = new Map<number, number>();

    const commit = (draft: Draft) => {
      if (isToolbarKey(draft.event)) return;
      const durationMs = draft.exactMs ?? draft.fallbackMs ?? 0;
      const interaction: Interaction = { id: draft.id, kind: draft.kind, target: draft.target, member: draft.member, durationMs, approximate: draft.exactMs === null };
      setHistory((previous) => {
        const index = previous.findIndex((entry) => entry.id === draft.id);
        if (index === -1) return [...previous, interaction].slice(-HISTORY_LIMIT);
        const copy = [...previous];
        copy[index] = interaction;
        return copy;
      });
    };

    const onInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const member = memberOf(target, shell);
      if (!member) return;
      const eventName = event.type === "keydown" ? "keydown" : "click";
      // A click that Enter or Space fires belongs to that key press, which is already recorded.
      if (eventName === "click" && (event as MouseEvent).detail === 0 && !(event as PointerEvent).pointerType) return;
      const kind: Interaction["kind"] = eventName === "keydown" ? "Key press" : (event as PointerEvent).pointerType === "touch" ? "Tap" : "Click";
      const draft: Draft = { id: nextId++, event, kind, target: describeTarget(target), member, start: event.timeStamp, eventName, fallbackMs: null, exactMs: null };
      drafts.push(draft);
      if (drafts.length > LIMIT) drafts.shift();
      // The handlers run after this capture listener; the frame after them is the fallback's paint.
      window.requestAnimationFrame(() =>
        window.setTimeout(() => {
          draft.fallbackMs = performance.now() - draft.start;
          commit(draft);
        }, 0),
      );
    };

    let observer: PerformanceObserver | null = null;
    if (eventTiming) {
      observer = new PerformanceObserver((list) => {
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
      });
      observer.observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
    }

    document.addEventListener("click", onInput, true);
    document.addEventListener("keydown", onInput, true);
    return () => {
      observer?.disconnect();
      document.removeEventListener("click", onInput, true);
      document.removeEventListener("keydown", onInput, true);
    };
  }, [shell, eventTiming]);

  const interactions = history.filter((interaction) => interaction.id > clearedThrough).slice(-LIMIT);
  const inpMs = interactionToNextPaint(history);
  return <TimingContext value={{ interactions, inpMs, vitals, eventTiming, hotSpots, setHotSpots, clear: () => setClearedThrough(history.at(-1)?.id ?? clearedThrough) }}>{children}</TimingContext>;
}
