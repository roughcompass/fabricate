"use client";

import { useEffect, useRef, useState } from "react";
import { mockRefusalText } from "@/components/toolbar/data/mock-refusals";
import { type ViewWorkerStatus, ViewWorker, browserWorkerEnvironment, mocksKey, routingKey } from "@/components/toolbar/routing/view-worker";
import { viewKey } from "@/components/toolbar/view-context";
import { routes } from "@/lib/web/routes";
import { DeviceFrame } from "./device-frame";
import styles from "./preview-mocks.module.css";

/*
 * Preview mode's mock set (add-mock-sets, design decision 16; template-
 * preview spec, "Preview mode applies the view's mock set and names it"):
 * the same active set as the running application of the build shown, which
 * the page resolves, applied through the view's worker before the device
 * frame loads, with a line above the browser window that names it, or says
 * why it can't apply. Preview mode is a view of its own, its address and
 * the saved preview it shows, so it never takes a running application's
 * table. It has no Data tool, so mocked answers come at once.
 */

/** The set preview mode applies: the application's slug, the set, and the saved preview shown, if any. */
export interface PreviewMocks {
  readonly application: string;
  readonly set: string;
  readonly name: string;
  readonly revision: number;
  /** The saved preview shown, by its key; null for the tracked branch and for an unsaved branch or tag. */
  readonly preview: string | null;
}

/** How often the page arms the worker again while it's open; the worker drops a table not armed for 90 seconds. */
const REARM_MS = 5000;

/** The frame's address, while it shows a page. */
function frameAddress(): string | null {
  try {
    const href = document.querySelector<HTMLIFrameElement>("[data-preview-frame]")?.contentWindow?.location.href ?? null;
    return href && href !== "about:blank" ? href : null;
  } catch {
    return null;
  }
}

/** Preview mode's view worker for +slug+'s +preview+, or its tracked branch, and the build at +scope+. */
function previewWorker(slug: string, preview: string | null, scope: string): ViewWorker {
  const key = `${viewKey(slug, preview)}/preview`;
  return new ViewWorker({ view: routes.applicationPreview(slug), share: null, preview }, scope, { routing: routingKey(key), mocks: mocksKey(key) }, browserWorkerEnvironment());
}

/** What the line above the window says of the set named +name+, once the worker answered with +status+. */
export function previewMockLine(name: string, status: Pick<ViewWorkerStatus, "refusal" | "readiness"> | null): string {
  if (status?.refusal) return `Mock set: ${name}. ${mockRefusalText(status.refusal)}`;
  if (status?.readiness && !status.readiness.ok) return `Mock set: ${name}. ${status.readiness.reason} The frame loaded without it.`;
  return `Mock set: ${name}. Change it with Data in full screen.`;
}

/** The device frame, loading once preview mode's set is ready, under the line that names the set. */
export function MockedDeviceFrame({ mocks, base, ...frame }: { mocks: PreviewMocks; base: string; width: number; height: number; title: string; address: string }) {
  const [status, setStatus] = useState<ViewWorkerStatus | null>(null);
  const worker = useRef<ViewWorker | null>(null);
  const { application, set, revision, preview } = mocks;

  useEffect(() => {
    let live = true;
    const coordinator = previewWorker(application, preview, base);
    coordinator.setMocks({ application, set, revision, latency: "off" });
    worker.current = coordinator;
    void coordinator.prepare(null).then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, [application, set, revision, preview, base]);

  const armed = status !== null && !status.refusal;
  useEffect(() => {
    if (!armed) return;
    const timer = window.setInterval(() => void worker.current?.rearm(frameAddress()).catch(() => {}), REARM_MS);
    return () => window.clearInterval(timer);
  }, [armed]);

  return (
    <>
      <p className={styles.line} data-mock-line="">
        {previewMockLine(mocks.name, status)}
      </p>
      <DeviceFrame {...frame} src={status ? base : null} noscript={base} />
    </>
  );
}

/**
 * With no set applying, releases preview mode's worker for the build, which
 * a set applied to before, unregistering it when no other view of the build
 * uses it.
 */
export function PreviewMocksRelease({ slug, preview, base }: { slug: string; preview: string | null; base: string }) {
  useEffect(() => {
    void previewWorker(slug, preview, base)
      .prepare(null)
      .catch(() => {});
  }, [slug, preview, base]);
  return null;
}
