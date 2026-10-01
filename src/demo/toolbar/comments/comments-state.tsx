"use client";

import { createContext, use, useEffect, useState } from "react";
import type { ThreadRecord } from "@/lib/demo/comments";
import { useRuntime } from "../../runtime/runtime-context";

/**
 * The comment threads of the current view, loaded from and written through
 * the demo's comment endpoints. Field errors come back for the composer to show.
 */

export type FieldErrors = Partial<Record<string, string[]>>;
export type Outcome = { ok: true } | { ok: false; errors: FieldErrors };

export interface NewThread {
  route: string;
  member: string;
  memberVersion: string;
  anchor: string;
  offsetX: number;
  offsetY: number;
  body: string;
  authorName?: string;
}

export interface Comments {
  readonly threads: readonly ThreadRecord[];
  readonly displayName: string | null;
  readonly loaded: boolean;
  /** The thread whose popover is open, if any. */
  readonly openThread: string | null;
  setOpenThread(id: string | null): void;
  create(thread: NewThread): Promise<Outcome & { id?: string }>;
  reply(threadId: string, body: string, authorName?: string): Promise<Outcome>;
  setStatus(threadId: string, status: "open" | "resolved"): Promise<Outcome>;
}

export const CommentsContext = createContext<Comments | null>(null);

export function useComments(): Comments {
  const comments = use(CommentsContext);
  if (!comments) throw new Error("useComments must be used inside the comments provider");
  return comments;
}

async function send(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, data };
}

export function CommentsProvider({ children }: { children: React.ReactNode }) {
  const { descriptor } = useRuntime();
  const application = descriptor.applicationId;
  const [threads, setThreads] = useState<readonly ThreadRecord[]>([]);
  const [displayName, setDisplayName] = useState<string | null>(descriptor.displayName);
  const [loaded, setLoaded] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/demo/threads?application=${encodeURIComponent(application)}`)
      .then((response) => (response.ok ? response.json() : { threads: [], displayName: null }))
      .then((data: { threads: ThreadRecord[]; displayName: string | null }) => {
        if (cancelled) return;
        setThreads(data.threads);
        if (data.displayName) setDisplayName(data.displayName);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [application]);

  const apply = (result: { ok: boolean; data: Record<string, unknown> }): Outcome => {
    if (Array.isArray(result.data.threads)) setThreads(result.data.threads as ThreadRecord[]);
    if (typeof result.data.displayName === "string") setDisplayName(result.data.displayName);
    if (result.ok) return { ok: true };
    return { ok: false, errors: (result.data.errors as FieldErrors | undefined) ?? { body: ["The comment could not be saved. Try again."] } };
  };

  const comments: Comments = {
    threads,
    displayName,
    loaded,
    openThread,
    setOpenThread,
    async create(thread) {
      const result = await send("/api/demo/threads", { application, ...thread });
      const outcome = apply(result);
      return outcome.ok ? { ok: true, id: result.data.id as string } : outcome;
    },
    async reply(threadId, body, authorName) {
      return apply(await send(`/api/demo/threads/${threadId}/comments`, { application, body, ...(authorName ? { authorName } : {}) }));
    },
    async setStatus(threadId, status) {
      return apply(await send(`/api/demo/threads/${threadId}/status`, { application, status }));
    },
  };

  return <CommentsContext value={comments}>{children}</CommentsContext>;
}
