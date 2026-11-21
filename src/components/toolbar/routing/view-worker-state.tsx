"use client";

import { createContext, use, useEffect, useEffectEvent, useRef, useState } from "react";
import { routes } from "@/lib/web/routes";
import { usePreload, useTargetDocument } from "../target-document";
import { useToolbarView } from "../view-context";
import type { ArmedMocks } from "./table";
import { type RoutingPart, type ViewWorkerStatus, type WorkerRefusal, ViewWorker, browserWorkerEnvironment, mocksKey, routingKey, workerRefusal } from "./view-worker";

/**
 * The toolbar's view worker (add-mock-sets, design decision 2): the
 * coordinator for the view the toolbar is over, which Microfrontends and
 * Data contribute their parts to. Before each load of the frame it composes
 * them into the view's table and arms the worker once, then arms it again
 * every few seconds while the page is open. It says why the worker can't
 * run for the build, as soon as that's known, and what the last load
 * applied.
 */

interface Readers {
  routing?: () => RoutingPart;
  mocks?: () => ArmedMocks | null;
}

interface ViewWorkerState {
  /** Why the view's worker can't run for the build in this browser, known before anything applies; null when it can, or until it's known. */
  readonly refusal: WorkerRefusal | null;
  /** What the last load applied, and what the worker answered; null before the first load. */
  readonly status: ViewWorkerStatus | null;
  /** Adds a part the coordinator reads before each load; returns a function that removes it. */
  contribute<K extends keyof Readers>(kind: K, read: NonNullable<Readers[K]>): () => void;
}

const ViewWorkerContext = createContext<ViewWorkerState | null>(null);

export function useViewWorker(): ViewWorkerState {
  const state = use(ViewWorkerContext);
  if (!state) throw new Error("useViewWorker must be used inside the view worker provider");
  return state;
}

/** Adds +read+, which gives a tool's part of the view's table, to what the coordinator reads before each load, while mounted. */
export function useViewWorkerPart<K extends keyof Readers>(kind: K, read: NonNullable<Readers[K]>): void {
  const { contribute } = useViewWorker();
  const run = useEffectEvent(() => read());
  useEffect(() => contribute(kind, (() => run()) as NonNullable<Readers[K]>), [contribute, kind]);
}

/** How often the page arms the worker again while it's open; the worker drops a table not armed for 90 seconds. */
const REARM_MS = 5000;

const NO_ROUTING: RoutingPart = { routes: [], kept: [] };

/** The frame's address, while it shows a page. */
function frameAddress(frame: HTMLIFrameElement | null): string | null {
  try {
    const href = frame?.contentWindow?.location.href ?? null;
    return href && href !== "about:blank" ? href : null;
  } catch {
    return null;
  }
}

/**
 * The coordinator for a running application's view. +share+ is the token
 * of the share link the view was opened through, if it opened one; such a
 * view keeps nothing of its own in the browser.
 */
export function ViewWorkerProvider({ share, children }: { share: string | null; children: React.ReactNode }) {
  const target = useTargetDocument();
  const view = useToolbarView();
  const scope = target.base;
  const [readers] = useState<Readers>(() => ({}));
  const [refusal, setRefusal] = useState<WorkerRefusal | null>(null);
  const [status, setStatus] = useState<ViewWorkerStatus | null>(null);
  const worker = useRef<ViewWorker | null>(null);
  const [contribute] = useState(() => <K extends keyof Readers>(kind: K, read: NonNullable<Readers[K]>) => {
    readers[kind] = read;
    return () => {
      if (readers[kind] === read) delete readers[kind];
    };
  });

  /** The view's worker, made in the browser on first use: the view is its address and the share token the page's address keeps. */
  const viewWorker = () =>
    (worker.current ??= new ViewWorker(
      { view: routes.runningApplication(view.slug, "", undefined, view.preview), share: new URLSearchParams(window.location.search).get("share") },
      scope,
      share ? null : { routing: routingKey(view.key), mocks: mocksKey(view.key) },
      browserWorkerEnvironment(),
    ));

  // Whether this browser and the build's path allow the worker at all, said before anyone chooses.
  useEffect(() => {
    let live = true;
    void workerRefusal(scope, browserWorkerEnvironment()).then((reason) => {
      if (live) setRefusal(reason);
    });
    return () => {
      live = false;
    };
  }, [scope]);

  usePreload(async (address) => {
    const coordinator = viewWorker();
    coordinator.setRouting(readers.routing?.() ?? NO_ROUTING);
    coordinator.setMocks(readers.mocks?.() ?? null);
    setStatus(await coordinator.prepare(frameAddress(target.frame)));
    return address;
  });

  const rearm = useEffectEvent(() => void viewWorker().rearm(frameAddress(target.frame)).catch(() => {}));
  const applies = status !== null && !status.refusal && (status.routed || status.mocks !== null);
  useEffect(() => {
    if (!applies) return;
    const timer = window.setInterval(() => rearm(), REARM_MS);
    return () => window.clearInterval(timer);
  }, [applies, status]);

  return <ViewWorkerContext value={{ refusal, status, contribute }}>{children}</ViewWorkerContext>;
}
