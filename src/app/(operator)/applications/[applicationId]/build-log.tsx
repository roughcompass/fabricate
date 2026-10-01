"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { type BuildProgress, buildProgress } from "@/lib/demo/build";
import type { StageScript } from "@/lib/demo/catalog";
import styles from "../applications.module.css";

interface BuildLogProps {
  script: readonly StageScript[];
  createdAt: number;
  skippedAt: number | null;
  /** The server's clock when the page rendered, so a browser clock that is off does not change progress. */
  serverNow: number;
}

const TICK_MS = 200;

/** "00:03.2": time since the build started. */
function elapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;
}

/**
 * The simulated build log. Progress is derived from the build's creation time
 * (design.md, decision 5), so a reload resumes where it was. When the build
 * finishes, the page refreshes so Visit application becomes available.
 */
export function BuildLog({ script, createdAt, skippedAt, serverNow }: BuildLogProps) {
  const router = useRouter();
  const skew = useRef<number | null>(null);
  const [now, setNow] = useState(serverNow);
  const progress: BuildProgress = buildProgress(script, createdAt, now, skippedAt);
  const building = progress.status === "building";

  useEffect(() => {
    skew.current ??= serverNow - Date.now();
    if (!building) return;
    const timer = window.setInterval(() => setNow(Date.now() + (skew.current ?? 0)), TICK_MS);
    return () => window.clearInterval(timer);
  }, [building, serverNow]);

  const finishedHere = useRef(false);
  useEffect(() => {
    // Refresh once when the build finishes in this tab, so the server renders the ready page.
    if (!building && now !== serverNow && !finishedHere.current) {
      finishedHere.current = true;
      router.refresh();
    }
  }, [building, now, serverNow, router]);

  return (
    <ol className={styles.log} aria-label="Build log" aria-live="polite">
      {progress.stages.map((stage) => (
        <li key={stage.name} className={styles.stage} data-state={stage.state}>
          <span className={styles.stageIcon} aria-hidden="true">
            {stage.state === "done" ? <Icon name="check" size={14} /> : stage.state === "active" ? <Icon name="spinner" size={14} className={styles.spin} /> : null}
          </span>
          <span className={styles.stageName}>
            {stage.name}
            <span className="visually-hidden">{stage.state === "done" ? ", done" : stage.state === "active" ? ", in progress" : ", waiting"}</span>
          </span>
          <time className={styles.stageTime}>{stage.state === "pending" ? "" : elapsed(stage.startMs)}</time>
          {stage.lines.length > 0 && (
            <ul className={styles.lines}>
              {stage.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
      <li className={styles.stage} data-state={building ? "pending" : "done"}>
        <span className={styles.stageIcon} aria-hidden="true">
          {!building && <Icon name="check" size={14} />}
        </span>
        <span className={styles.stageName}>
          Ready
          <span className="visually-hidden">{building ? ", waiting" : ", done"}</span>
        </span>
        <time className={styles.stageTime}>{building ? "" : elapsed(progress.totalMs)}</time>
      </li>
    </ol>
  );
}
