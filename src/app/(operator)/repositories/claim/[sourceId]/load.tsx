import { cookies } from "next/headers";
import { cache } from "react";
import { Alert } from "@/components/ui/alert";
import type { Choice } from "@/components/ui/form";
import { RelativeTime } from "@/components/ui/relative-time";
import { findSource } from "@/lib/catalog/source-records";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { type ClaimChoices, claimChoices } from "@/lib/ownership/claims";
import { type DeConsoleStatus, deConsoleStatus } from "@/lib/ownership/de-console";
import type { LabelRef } from "@/lib/ownership/read";
import { CLAIMANT_COOKIE } from "../form-state";

/** The repository a claim page is about, read once per request. */
export const loadClaim = cache((sourceId: string) => {
  if (!isPublicId(sourceId, "src")) return null;
  const db = getDb();
  const source = findSource(db, sourceId);
  return source ? { db, source } : null;
});

export const claimCrumbs = [
  { href: "/repositories", label: "Repositories" },
  { href: "/repositories/claim", label: "Claim a Repository" },
];

/** The name or email the claimant entered last time, to fill in again. */
export async function rememberedClaimant(): Promise<string> {
  return (await cookies()).get(CLAIMANT_COOKIE)?.value ?? "";
}

/** The approved values as form choices, plus any current values that are still pending. */
export function choicesFor(db: Parameters<typeof claimChoices>[0], current: { portals?: readonly LabelRef[]; lineOfBusiness?: LabelRef | null } = {}): { portals: Choice[]; linesOfBusiness: { value: string; label: string }[]; approved: ClaimChoices } {
  const approved = claimChoices(db);
  const withCurrent = (listed: readonly LabelRef[], extra: readonly LabelRef[]) => [...listed, ...extra.filter((item) => !listed.some((entry) => entry.id === item.id))];
  return {
    approved,
    portals: withCurrent(approved.portals, current.portals ?? []).map((portal) => ({ value: portal.label, label: portal.label, description: portal.conceptKey ? undefined : "Pending review" })),
    linesOfBusiness: withCurrent(approved.linesOfBusiness, current.lineOfBusiness ? [current.lineOfBusiness] : []).map((line) => ({ value: line.label, label: line.conceptKey ? line.label : `${line.label} (pending review)` })),
  };
}

/** Shown when the latest DE Console read failed: the claim goes on with the last values read. */
export function DeConsoleAlert({ status = deConsoleStatus(getDb()) }: { status?: DeConsoleStatus }) {
  if (!getConfig().deConsole.source || status.lastAttempt?.status !== "failed") return null;
  return (
    <Alert tone="warning" title="The DE Console couldn't be read">
      {status.lastSuccess ? (
        <>
          You can still claim this Repository. DE Console values here are from its last successful read, <RelativeTime value={status.lastSuccess.readAt} />.
        </>
      ) : (
        "You can still claim this Repository. Nothing has been read from the DE Console yet, so enter the values it would provide."
      )}
    </Alert>
  );
}
