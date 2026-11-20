"use client";

import { createContext, use, useEffect, useState } from "react";
import type { FieldErrors, NewThread, PlacedThread, StoreResult, ThreadStore } from "./thread-store";

/**
 * The running application's comment threads, loaded from and written through
 * its ThreadStore. Field errors come back for the composer to show.
 */

export type Outcome = { ok: true; id?: string } | { ok: false; errors: FieldErrors };

/** The view the comments are shown in: the application, the saved preview shown or null for the tracked branch, the tracked branch's name, and the share link that opened it. */
export interface CommentScope {
  readonly slug: string;
  readonly preview: string | null;
  readonly tracked: string;
  readonly share: string | null;
}

/** Whether +thread+ was placed on the preview the view shows: the same saved preview, or the tracked branch for both. */
export function onThisPreview(thread: Pick<PlacedThread, "preview">, scope: Pick<CommentScope, "preview">): boolean {
  return scope.preview === null ? thread.preview === null : thread.preview?.key === scope.preview;
}

export interface Comments {
  readonly scope: CommentScope;
  readonly threads: readonly PlacedThread[];
  readonly displayName: string | null;
  readonly loaded: boolean;
  /** The thread whose popover is open, if any. */
  readonly openThread: string | null;
  setOpenThread(id: string | null): void;
  create(thread: NewThread): Promise<Outcome>;
  reply(threadId: string, body: string, authorName?: string): Promise<Outcome>;
  setStatus(threadId: string, status: PlacedThread["status"]): Promise<Outcome>;
}

const CommentsContext = createContext<Comments | null>(null);

export function useComments(): Comments {
  const comments = use(CommentsContext);
  if (!comments) throw new Error("useComments must be used inside the comments provider");
  return comments;
}

export function CommentsProvider({ store, scope, children }: { store: ThreadStore; scope: CommentScope; children: React.ReactNode }) {
  const [threads, setThreads] = useState<readonly PlacedThread[]>([]);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openThread, setOpenThread] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    store
      .load()
      .then((view) => {
        if (cancelled) return;
        setThreads(view.threads);
        setDisplayName(view.displayName);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const apply = (result: StoreResult): Outcome => {
    if (!result.ok) return { ok: false, errors: result.errors };
    setThreads(result.threads);
    setDisplayName(result.displayName);
    return { ok: true, ...(result.id ? { id: result.id } : {}) };
  };
  const failed: Outcome = { ok: false, errors: { body: ["The comment could not be saved. Try again."] } };
  const attempt = (write: () => Promise<StoreResult>) => write().then(apply, () => failed);

  const comments: Comments = {
    scope,
    threads,
    displayName,
    loaded,
    openThread,
    setOpenThread,
    create: (thread) => attempt(() => store.create(thread)),
    reply: (threadId, body, authorName) => attempt(() => store.reply(threadId, body, authorName)),
    setStatus: (threadId, status) => attempt(() => store.setStatus(threadId, status)),
  };

  return <CommentsContext value={comments}>{children}</CommentsContext>;
}
