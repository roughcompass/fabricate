"use client";

import { createContext, use, useEffect, useState, useSyncExternalStore } from "react";
import { shellOf } from "@/lib/demo/catalog";
import { useRuntime } from "../../runtime/runtime-context";
import { memberOf } from "../geometry";
import type { Interaction } from "./timing";

/**
 * Interaction timing, recorded from the moment the application opens so the
 * tool has data whenever it is opened. Each click, tap, or key press in the
 * application (never the toolbar) is timed from input to the next paint with
 * the Event Timing API. Browsers without it get an approximate measure: from
 * the input to the next frame after its handlers finish.
 */

interface TimingState {
  readonly interactions: readonly Interaction[];
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

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** A person-readable name for the element an interaction targeted. */
export function describeTarget(target: Element): string {
  const control = target.closest("button, a, input, select, textarea, [role='button'], [role='link'], [data-demo-anchor]") ?? target;
  const tag = control.tagName.toLowerCase();
  const name = (control.getAttribute("aria-label") || (control as HTMLElement).innerText || control.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim();
  return name ? `${tag} "${truncate(name, 40)}"` : tag;
}

interface Draft {
  id: number;
  kind: Interaction["kind"];
  target: string;
  member: string;
  start: number;
  eventName: "click" | "keydown";
  fallbackMs: number | null;
  exactMs: number | null;
}

const subscribeNever = () => () => {};

function supportsEventTiming(): boolean {
  return typeof PerformanceObserver !== "undefined" && (PerformanceObserver.supportedEntryTypes ?? []).includes("event");
}

export function TimingProvider({ children }: { children: React.ReactNode }) {
  const { app } = useRuntime();
  const [interactions, setInteractions] = useState<readonly Interaction[]>([]);
  const eventTiming = useSyncExternalStore(subscribeNever, supportsEventTiming, () => false);
  const [hotSpots, setHotSpots] = useState(false);
  const shell = shellOf(app).id;

  useEffect(() => {
    let next = 1;
    const drafts: Draft[] = [];
    const byInteraction = new Map<number, Draft>();
    // Entries for an interaction's other events (pointerdown, keyup) can arrive before its click or keydown.
    const unmatched = new Map<number, number>();

    const commit = (draft: Draft) => {
      const durationMs = draft.exactMs ?? draft.fallbackMs ?? 0;
      const interaction: Interaction = { id: draft.id, kind: draft.kind, target: draft.target, member: draft.member, durationMs, approximate: !eventTiming };
      setInteractions((previous) => {
        const index = previous.findIndex((entry) => entry.id === draft.id);
        if (index === -1) return [...previous, interaction].slice(-LIMIT);
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
      const kind: Interaction["kind"] = eventName === "keydown" ? "Key press" : (event as PointerEvent).pointerType === "touch" ? "Tap" : "Click";
      const draft: Draft = { id: next++, kind, target: describeTarget(target), member, start: event.timeStamp, eventName, fallbackMs: null, exactMs: null };
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

  return <TimingContext value={{ interactions, eventTiming, hotSpots, setHotSpots, clear: () => setInteractions([]) }}>{children}</TimingContext>;
}
