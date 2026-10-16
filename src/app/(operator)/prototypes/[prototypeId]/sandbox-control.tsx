import { ProgressPoller } from "@/components/progress-poller";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatAbsolute } from "@/components/ui/time";
import { SANDBOX_MINUTES, SANDBOX_UNCONFIGURED, type SandboxRun, sandboxLive } from "@/lib/prototypes/sandbox";
import { startSandboxAction } from "./share-actions";
import styles from "./prototype.module.css";

/**
 * Open in Vercel Sandbox (preview spec, "A version can run as a standalone
 * app on Vercel Sandbox"): unavailable with the reason when Sandbox isn't
 * configured; while starting, its progress; when ready, the public address
 * and when it stops.
 */
export function SandboxControl({ prototypeId, versionId, number, configured, run }: { prototypeId: string; versionId: string; number: number; configured: boolean; run: SandboxRun | null }) {
  const start = (label: string) => (
    <form action={startSandboxAction}>
      <input type="hidden" name="prototype" value={prototypeId} />
      <input type="hidden" name="version" value={versionId} />
      <SubmitButton variant="secondary" size="sm" icon="external" pendingLabel="Starting">
        {label}
      </SubmitButton>
    </form>
  );
  if (!configured) {
    return (
      <div className={styles.sandbox} data-sandbox="unavailable">
        <Button type="button" size="sm" icon="external" disabled aria-describedby="sandbox-unavailable">
          Open in Vercel Sandbox
        </Button>
        <p id="sandbox-unavailable" className={styles.muted}>
          {SANDBOX_UNCONFIGURED}
        </p>
      </div>
    );
  }
  if (run?.status === "starting") {
    return (
      <div className={styles.sandbox} data-sandbox="starting">
        <ProgressPoller url={`/api/prototypes/sandbox/${run.id}/status`} version={`${run.status}|${run.stage}`} intervalMs={2_000} />
        <Status state="checking" label={run.stage ?? "Starting"} />
        <p className={styles.muted}>Installing takes a minute or two.</p>
      </div>
    );
  }
  if (run && run.url && sandboxLive(run)) {
    return (
      <div className={styles.sandbox} data-sandbox="ready">
        <p className={styles.muted}>
          <strong>Public address.</strong> Anyone with it can open this app, which holds only fictional data. It stops at <time dateTime={run.stopsAt!.toISOString()}>{formatAbsolute(run.stopsAt!)}</time>.
        </p>
        <a href={run.url} target="_blank" rel="noreferrer" className={styles.sandboxUrl}>
          {run.url}
        </a>
      </div>
    );
  }
  return (
    <div className={styles.sandbox} data-sandbox={run?.status ?? "idle"}>
      {start(`Open v${number} in Vercel Sandbox`)}
      {run?.status === "failed" && <p className={styles.muted}>{`The last start failed: ${run.error ?? "unknown error"}`}</p>}
      <p className={styles.muted}>{`Runs this version as a standalone app at a public address for ${SANDBOX_MINUTES} minutes.`}</p>
    </div>
  );
}
