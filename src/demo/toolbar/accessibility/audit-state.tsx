"use client";

import { createContext, use, useState } from "react";
import { memberById, shellOf } from "@/lib/demo/catalog";
import { useActivity, useRouting, useRuntime } from "../../runtime/runtime-context";
import { AUDIT_TAGS, type Attribution, type AuditReport, type RawViolation, summarize } from "./audit";

/**
 * The audit's results, kept above the panel so the page stays outlined while
 * the panel is closed. Results become stale when the page changes after the
 * audit: navigation, a version change, or a settings change.
 */

interface AxeRunner {
  run(context: unknown, options: unknown): Promise<{ violations: RawViolation[] }>;
}

export interface AuditState {
  readonly report: AuditReport | null;
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

const SETTLE_TIMEOUT_MS = 10_000;

/** Resolves once every microfrontend region has finished loading, so the audit sees the whole page. */
function regionsSettled(): Promise<void> {
  const started = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      const loading = document.querySelector('[data-demo-mfe]:not([data-demo-state="ready"])');
      if (!loading || performance.now() - started > SETTLE_TIMEOUT_MS) resolve();
      else window.setTimeout(check, 100);
    };
    check();
  });
}

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const { app } = useRuntime();
  const routing = useRouting();
  const { changes } = useActivity();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [auditedAt, setAuditedAt] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showOutlines, setShowOutlines] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const shell = shellOf(app);

  const attribute = (selector: string): Attribution => {
    const region = selector ? document.querySelector(selector)?.closest("[data-demo-mfe]") : null;
    const member = region?.getAttribute("data-demo-mfe") ?? shell.id;
    return { member, memberName: memberById(app, member)?.name ?? member, version: region?.getAttribute("data-demo-version") ?? routing[shell.id]!.version };
  };

  const run = () => {
    setRunning(true);
    setFailed(false);
    setSelected(null);
    void regionsSettled()
      .then(() => import("axe-core"))
      .then(async (module) => {
        const axe = ((module as { default?: AxeRunner }).default ?? module) as AxeRunner;
        // Capture the change count before the audit, so a change during it marks the results stale.
        const at = changes;
        const result = await axe.run({ include: [["[data-demo-app-root]"]], exclude: [["[data-demo-toolbar]"]] }, { runOnly: { type: "tag", values: [...AUDIT_TAGS] }, resultTypes: ["violations"] });
        setReport(summarize(result.violations, attribute));
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
    stale: report !== null && auditedAt !== changes,
    showOutlines,
    selected,
    run,
    setShowOutlines,
    select: setSelected,
  };
  return <AuditContext value={state}>{children}</AuditContext>;
}
