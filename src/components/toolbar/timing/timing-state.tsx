"use client";

import { createContext, use, useState } from "react";
import { interactionToNextPaint } from "@/components/toolbar/timing/timing";
import type { InspectedInteraction, InspectorMessage, MeasuredVital, Rating } from "../inspector/protocol";
import { routeOf, useAgentMessages, useTargetDocument } from "../target-document";
import { type PageLoad, addLoads, pageLoad } from "./load-order";

/**
 * Timing for a running application (add-applications, design decision 6).
 * The frame agent (inspector/inspector.ts) measures the application's page
 * in its own realm and reports Web Vitals, the scripts and stylesheets it
 * loaded, and every interaction except the toolbar's own. This keeps what it
 * reported for the page now in the frame: a new page starts over. INP is
 * computed here, from the application's interactions since the page loaded,
 * so clearing the list keeps it.
 */

export interface RouteInteraction extends InspectedInteraction {
  /** The application route it happened on. */
  readonly route: string;
}

export interface MeasuredValue {
  readonly value: number;
  readonly rating: Rating;
}

interface TimingState {
  /** The latest interactions since the list was last cleared. */
  readonly interactions: readonly RouteInteraction[];
  /** INP over every interaction since the page loaded; clearing the list keeps it. */
  readonly inpMs: number | null;
  readonly vitals: Readonly<Partial<Record<MeasuredVital, MeasuredValue>>>;
  readonly loads: readonly PageLoad[];
  /** Whether the agent is reporting from the page. */
  readonly inspecting: boolean;
  readonly eventTiming: boolean;
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

interface Page {
  /** The agent's id for the page these measurements are of. */
  readonly page: string | null;
  readonly inspecting: boolean;
  readonly eventTiming: boolean;
  readonly vitals: TimingState["vitals"];
  readonly loads: readonly PageLoad[];
  readonly history: readonly RouteInteraction[];
  /** Interactions with an id at or below this were cleared from the list. */
  readonly clearedThrough: number;
}

const fresh = (page: string | null): Page => ({ page, inspecting: false, eventTiming: true, vitals: {}, loads: [], history: [], clearedThrough: 0 });

/** +current+ with what +message+ reports, for a build served at +base+. */
function reduce(current: Page, message: InspectorMessage, base: string): Page {
  switch (message.kind) {
    case "ready":
      return { ...current, inspecting: true, eventTiming: message.eventTiming };
    case "vital":
      return { ...current, vitals: { ...current.vitals, [message.name]: { value: message.value, rating: message.rating } } };
    case "loads":
      return { ...current, loads: addLoads(current.loads, message.loads.map((load) => pageLoad(load, base, window.location.origin))) };
    case "interaction": {
      const interaction: RouteInteraction = { ...message.interaction, route: routeOf(message.interaction.pathname, base) };
      const index = current.history.findIndex((entry) => entry.id === interaction.id);
      const history = index === -1 ? [...current.history, interaction].slice(-HISTORY_LIMIT) : current.history.with(index, interaction);
      return { ...current, history };
    }
    default:
      return current;
  }
}

export function TimingProvider({ children }: { children: React.ReactNode }) {
  const { base, page: shown } = useTargetDocument();
  const [page, setPage] = useState<Page>(() => fresh(shown));
  // Another page in the frame starts over.
  if (page.page !== shown) setPage(fresh(shown));

  useAgentMessages((message) => setPage((current) => (current.page === message.page ? reduce(current, message, base) : current)));

  const since = page.history.filter((interaction) => interaction.id > page.clearedThrough);
  const state: TimingState = {
    interactions: since.slice(-LIMIT),
    inpMs: interactionToNextPaint(page.history),
    vitals: page.vitals,
    loads: page.loads,
    inspecting: page.inspecting,
    eventTiming: page.eventTiming,
    clear: () => setPage((current) => ({ ...current, clearedThrough: current.history.at(-1)?.id ?? current.clearedThrough })),
  };
  return <TimingContext value={state}>{children}</TimingContext>;
}
