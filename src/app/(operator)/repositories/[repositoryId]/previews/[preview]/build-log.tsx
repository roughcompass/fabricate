"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import type { AttemptState } from "@/lib/db/schema";
import type { LogChunk } from "@/lib/previews/log";
import styles from "./preview.module.css";

/** What the log endpoint answers: a chunk of the latest attempt's log, and the attempt's state. */
type LogResponse = LogChunk & { state: AttemptState };

/** How often the log is read while the attempt is under way. */
const POLL_MS = 1_000;
/** How many more reads a finished attempt gets for the lines a worker writes after it settles, such as the final one. */
const SETTLING_READS = 5;
/** The most log text the page keeps; earlier lines are left out. */
const MAX_CHARS = 512 * 1024;

/** Whether +text+ holds the line that ends an attempt's log: ready, failed, stopped, or not published. */
export function endsAttempt(text: string): boolean {
  return /^==> (ready|failed|stopped|not published):/m.test(text);
}

/** +shown+ with +text+ appended, keeping at most MAX_CHARS from a line's start. */
export function appendLog(shown: { text: string; truncated: boolean }, text: string): { text: string; truncated: boolean } {
  const joined = shown.text + text;
  if (joined.length <= MAX_CHARS) return { text: joined, truncated: shown.truncated };
  const cut = joined.indexOf("\n", joined.length - MAX_CHARS);
  return { text: joined.slice(cut === -1 ? joined.length - MAX_CHARS : cut + 1), truncated: true };
}

interface BuildLogProps {
  preview: string;
  attempt: number;
  state: AttemptState;
  /** The log's tail as the page read it. */
  initial: Pick<LogChunk, "log" | "end" | "text" | "truncated">;
}

/**
 * The latest attempt's build log (spec "Preview states and logs are
 * visible"): its tail, as the page rendered it, then, while the attempt is
 * Queued or Building, every line written since, read by offset from
 * /api/previews/<id>/log once a second. A log that belongs to another
 * attempt starts over. When the attempt's state changes, the page refreshes,
 * so its state, alerts, and frame follow. The log stays scrolled to its end
 * unless the reader scrolled up. Without JavaScript, the tail as rendered.
 */
export function BuildLog({ preview, attempt, state, initial }: BuildLogProps) {
  const router = useRouter();
  const [shown, setShown] = useState({ text: initial.text, truncated: initial.truncated });
  const cursor = useRef({ log: initial.log, end: initial.end });
  const container = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const live = state === "queued" || state === "building";
  // A finished attempt's log is whole once its last line is in.
  const complete = !live && endsAttempt(initial.text);

  useEffect(() => {
    if (complete) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reads = live ? Number.POSITIVE_INFINITY : SETTLING_READS;
    const read = async () => {
      let more = false;
      try {
        const params = new URLSearchParams();
        if (cursor.current.log !== null) {
          params.set("log", cursor.current.log);
          params.set("from", String(cursor.current.end));
        }
        const response = await fetch(`/api/previews/${preview}/log${params.size ? `?${params}` : ""}`, { cache: "no-store" });
        if (!active) return;
        // Deleted, or previews were turned off: the page says so.
        if (response.status === 404) return router.refresh();
        if (response.ok) {
          const chunk = (await response.json()) as LogResponse;
          if (!active) return;
          const restart = chunk.reset || chunk.log !== cursor.current.log;
          cursor.current = { log: chunk.log, end: chunk.end };
          if (restart || chunk.text) setShown((current) => appendLog(restart ? { text: "", truncated: chunk.truncated } : current, chunk.text));
          if (chunk.state !== state || chunk.attempt !== attempt) router.refresh();
          if (!live && endsAttempt(chunk.text)) return;
          more = chunk.more;
        }
      } catch {
        // A missed read is retried on the next tick.
      }
      if (!active || --reads <= 0) return;
      timer = setTimeout(read, more ? 0 : POLL_MS);
    };
    timer = setTimeout(read, live ? POLL_MS : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [preview, attempt, state, live, complete, router]);

  // A refresh that read further into the same log than the page has, such as one into a finished state, shows what it read.
  useEffect(() => {
    if (initial.log === cursor.current.log && initial.end > cursor.current.end) {
      cursor.current = { log: initial.log, end: initial.end };
      setShown({ text: initial.text, truncated: initial.truncated });
    }
  }, [initial.log, initial.end, initial.text, initial.truncated]);

  // Keep the end in view as lines arrive, unless the reader scrolled up to read.
  useLayoutEffect(() => {
    const scroller = container.current?.querySelector<HTMLElement>("[data-code-scroll]");
    if (scroller && atEnd.current) scroller.scrollTop = scroller.scrollHeight;
  }, [shown.text]);

  if (!shown.text) {
    return (
      <Panel flush>
        <EmptyState title={live ? "No log yet" : "No log"} icon={live ? "clock" : "file"}>
          {live ? "The log starts when the build does." : "This attempt ended before its build started."}
        </EmptyState>
      </Panel>
    );
  }
  return (
    <div
      ref={container}
      className={styles.log}
      // Scrolling doesn't bubble, so the log's scrolling area is watched as the event passes on its way down.
      onScrollCapture={(event) => {
        const scroller = event.target as HTMLElement;
        if (scroller.matches("[data-code-scroll]")) atEnd.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
      }}
    >
      {shown.truncated && <p className={styles.note}>Earlier lines are left out.</p>}
      <CodeBlock code={shown.text.replace(/\n$/, "")} label={`Attempt ${attempt} log`} scroll />
    </div>
  );
}
