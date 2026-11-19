"use client";

import { createContext, use, useState } from "react";
import { AUDIT_TAGS, type AuditReport, type RawViolation, summarize } from "@/demo/toolbar/accessibility/audit";
import { AXE_SCRIPT } from "../inspector/protocol";
import { useTargetDocument } from "../target-document";

/**
 * The accessibility audit of a running application (add-applications, design
 * decision 6): axe-core, injected into the framed page's own window, audits
 * that page's document, so the toolbar around it is never part of the audit.
 * Each affected element is reported by its selector in the page and the route
 * it was found on. The results are kept above the panel, so the page stays
 * outlined while the panel is closed, and become stale when the page changes
 * after the audit: a route change inside the application, or another load of
 * its page, such as a newer build.
 */

/** What each affected element is attributed to: the route it was found on. */
export interface Found {
  readonly route: string;
}

interface AxeRunner {
  run(context: unknown, options: unknown): Promise<{ violations: RawViolation[] }>;
}

type AxeWindow = Window & { axe?: AxeRunner };

export interface AuditState {
  readonly report: AuditReport<Found> | null;
  readonly running: boolean;
  readonly failed: boolean;
  readonly stale: boolean;
  readonly showOutlines: boolean;
  readonly selected: number | null;
  run(): void;
  setShowOutlines(show: boolean): void;
  select(number: number | null): void;
}

const AuditContext = createContext<AuditState | null>(null);

export function useAudit(): AuditState {
  const audit = use(AuditContext);
  if (!audit) throw new Error("useAudit must be used inside the audit provider");
  return audit;
}

/** axe-core in +view+'s realm: the copy the page already has, or one the Frontend Registry serves, added to the page. */
function axeIn(view: Window): Promise<AxeRunner> {
  const present = (view as AxeWindow).axe;
  if (present) return Promise.resolve(present);
  return new Promise((resolve, reject) => {
    const script = view.document.createElement("script");
    script.src = AXE_SCRIPT;
    script.dataset.frontendRegistryAxe = "";
    script.addEventListener("load", () => {
      const added = (view as AxeWindow).axe;
      if (added) resolve(added);
      else reject(new Error("axe-core didn't start in the application's page"));
    });
    script.addEventListener("error", () => reject(new Error("axe-core couldn't be loaded")));
    (view.document.head ?? view.document.documentElement).append(script);
  });
}

/** Resolves once +view+'s page has loaded and painted, so the audit sees what's rendered. */
function settled(view: Window): Promise<void> {
  return new Promise((resolve) => {
    const paint = () => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()));
    if (view.document.readyState === "complete") paint();
    else view.addEventListener("load", paint, { once: true });
  });
}

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const target = useTargetDocument();
  const [report, setReport] = useState<AuditReport<Found> | null>(null);
  const [auditedAt, setAuditedAt] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showOutlines, setShowOutlines] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);

  const run = () => {
    const view = target.window;
    if (!view) {
      setFailed(true);
      return;
    }
    // The page as it is when the audit starts, so a change during it marks the results stale.
    const at = target.changes;
    const found: Found = { route: target.route };
    setRunning(true);
    setFailed(false);
    setSelected(null);
    void settled(view)
      .then(() => axeIn(view))
      .then(async (axe) => {
        // Frames inside the application aren't audited: axe would wait for a copy of itself in each.
        const result = await axe.run(view.document, { runOnly: { type: "tag", values: [...AUDIT_TAGS] }, resultTypes: ["violations"], iframes: false });
        setReport(summarize(result.violations, () => found));
        setAuditedAt(at);
        setShowOutlines(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setRunning(false));
  };

  const state: AuditState = {
    report,
    running,
    failed,
    stale: report !== null && auditedAt !== target.changes,
    showOutlines,
    selected,
    run,
    setShowOutlines,
    select: setSelected,
  };
  return <AuditContext value={state}>{children}</AuditContext>;
}
