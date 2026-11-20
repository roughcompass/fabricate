import type { ElementAnchor } from "./element-anchor";

/**
 * Where a running application's comment threads are kept: the visitor's
 * workspace, through the workspace's thread endpoints (src/app/api/
 * workspace/threads). Each thread records the route and the build's commit it
 * was placed on, and the element by its anchor (add-applications, design
 * decision 7, and the toolbar spec's "Comments stay bound to their element,
 * route, and commit"). Threads are private to the workspace until it shares
 * a view; a view opened through a share link reads and writes the sharer's
 * threads.
 */

export interface PlacedComment {
  readonly id: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface PlacedThread {
  readonly id: string;
  /** The application route it was placed at: `/accounts`. */
  readonly route: string;
  /** The commit of the build it was placed on. */
  readonly commit: string;
  readonly anchor: ElementAnchor;
  /** Where on the element, as fractions of its width and height. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly status: "open" | "resolved";
  readonly createdAt: string;
  readonly comments: readonly PlacedComment[];
}

export interface NewThread {
  readonly route: string;
  readonly commit: string;
  readonly anchor: ElementAnchor;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly body: string;
  readonly authorName?: string;
}

export type FieldErrors = Partial<Record<string, string[]>>;

export interface ThreadsView {
  /** Oldest first, so a thread's number is its place in the list. */
  readonly threads: readonly PlacedThread[];
  /** The name comments are posted under, once one has been given. */
  readonly displayName: string | null;
}

export type StoreResult = ({ readonly ok: true; readonly id?: string } & ThreadsView) | { readonly ok: false; readonly errors: FieldErrors };

export interface ThreadStore {
  load(): Promise<ThreadsView>;
  create(thread: NewThread): Promise<StoreResult>;
  reply(threadId: string, body: string, authorName?: string): Promise<StoreResult>;
  setStatus(threadId: string, status: PlacedThread["status"]): Promise<StoreResult>;
}

/** The workspace's endpoint at +path+ for the application +slug+, in the shared view +share+ when there is one. */
function endpoint(path: string, slug: string, share: string | null): string {
  const query = new URLSearchParams({ application: slug, ...(share ? { share } : {}) });
  return `/api/workspace/threads${path}?${query}`;
}

async function send(url: string, body: unknown): Promise<StoreResult> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Partial<ThreadsView & { id: string; errors: FieldErrors }>;
  if (!response.ok) return { ok: false, errors: data.errors ?? { body: ["The comment could not be saved. Try again."] } };
  return { ok: true, threads: data.threads ?? [], displayName: data.displayName ?? null, ...(data.id ? { id: data.id } : {}) };
}

/** The threads of the application +slug+ in the visitor's workspace, or in the view the share link +share+ opened. */
export function workspaceThreadStore(slug: string, share: string | null): ThreadStore {
  return {
    async load() {
      const response = await fetch(endpoint("", slug, share));
      if (!response.ok) return { threads: [], displayName: null };
      return (await response.json()) as ThreadsView;
    },
    create: (thread) => send(endpoint("", slug, share), thread),
    reply: (threadId, body, authorName) => send(endpoint(`/${encodeURIComponent(threadId)}/comments`, slug, share), { body, ...(authorName ? { authorName } : {}) }),
    setStatus: (threadId, status) => send(endpoint(`/${encodeURIComponent(threadId)}/status`, slug, share), { status }),
  };
}
