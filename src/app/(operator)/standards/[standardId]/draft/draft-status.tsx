"use client";

import { useEffect, useSyncExternalStore } from "react";
import { countLabel } from "@/components/ui/count";
import { Status } from "@/components/ui/status";

/** The open draft's issues as of its latest save, which the editor reports and the page header shows. */
interface Reported {
  readonly standard: string;
  readonly issues: number;
}

let reported: Reported | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reports the draft's issues after each save, so the page header's status follows the save bar's. */
export function useReportDraftIssues(standard: string, issues: number): void {
  useEffect(() => {
    reported = { standard, issues };
    for (const listener of listeners) listener();
  }, [standard, issues]);
}

/**
 * A draft's status beside its title (page-templates spec, "Standard draft"):
 * how many issues its saved version has, or that it's ready to publish. The
 * server renders the count it loaded; after a save, the editor's report.
 */
export function DraftStatus({ standard, issues }: { standard: string; issues: number }) {
  const latest = useSyncExternalStore(
    subscribe,
    () => reported,
    () => null,
  );
  const count = latest?.standard === standard ? latest.issues : issues;
  return count > 0 ? <Status state="draft_problems" label={countLabel(count, "issue")} /> : <Status state="draft_ready" />;
}
