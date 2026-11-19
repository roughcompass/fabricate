import { formatNumber } from "@/components/ui/count";
import type { ElementAnchor } from "./element-anchor";

/**
 * Where a running application's comment threads are kept. Each thread
 * records the route and the build's commit it was placed on, and the element
 * by its anchor (add-applications, design decision 6, and the toolbar spec's
 * "Comments stay bound to their element, route, and commit").
 *
 * The comment tools read and write threads only through a ThreadStore. The
 * workspace's own store, on the demo's thread endpoints, waits for the threads
 * table to take a commit and this anchor (design decision 7); until then the
 * test run page keeps threads in the browser tab (sessionThreadStore).
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

/** The longest comment, as for the workspace's comments (src/lib/demo/workspaces.ts). */
const COMMENT_LIMIT = 2000;
const NAME_LIMIT = 60;

function bodyErrors(body: string): string[] {
  const text = body.replace(/\r\n?/g, "\n").trim();
  if (!text) return ["Write a comment"];
  return text.length > COMMENT_LIMIT ? [`Use at most ${formatNumber(COMMENT_LIMIT)} characters`] : [];
}

/** The author's name: the one given now, or the one given before. */
function author(stored: string | null, provided: string | undefined): { name: string } | { errors: string[] } {
  const name = provided?.trim().replace(/\s+/g, " ") ?? "";
  if (name) return name.length > NAME_LIMIT ? { errors: [`Use at most ${NAME_LIMIT} characters`] } : { name };
  return stored ? { name: stored } : { errors: ["Enter a display name"] };
}

/**
 * Threads kept in the browser tab's session storage under +key+, for the
 * test run page. They last across reloads of the tab, and nobody else sees
 * them.
 */
export function sessionThreadStore(key: string, storage: () => Pick<Storage, "getItem" | "setItem"> = () => window.sessionStorage): ThreadStore {
  const read = (): ThreadsView => {
    try {
      const stored = JSON.parse(storage().getItem(key) ?? "null") as ThreadsView | null;
      return stored && Array.isArray(stored.threads) ? stored : { threads: [], displayName: null };
    } catch {
      return { threads: [], displayName: null };
    }
  };
  const write = (view: ThreadsView, id?: string): StoreResult => {
    storage().setItem(key, JSON.stringify(view));
    return { ok: true, ...view, ...(id ? { id } : {}) };
  };
  const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const comment = (authorName: string, body: string): PlacedComment => ({ id: newId("cmt"), authorName, body: body.replace(/\r\n?/g, "\n").trim(), createdAt: new Date().toISOString() });

  return {
    load: () => Promise.resolve(read()),
    create(thread) {
      const view = read();
      const named = author(view.displayName, thread.authorName);
      const errors: FieldErrors = { ...("errors" in named ? { authorName: named.errors } : {}), ...(bodyErrors(thread.body).length ? { body: bodyErrors(thread.body) } : {}) };
      if ("errors" in named || errors.body) return Promise.resolve({ ok: false, errors });
      const { body: _body, authorName: _authorName, ...placed } = thread;
      const id = newId("thr");
      const created: PlacedThread = { ...placed, id, status: "open", createdAt: new Date().toISOString(), comments: [comment(named.name, thread.body)] };
      return Promise.resolve(write({ threads: [...view.threads, created], displayName: named.name }, id));
    },
    reply(threadId, body, authorName) {
      const view = read();
      const named = author(view.displayName, authorName);
      const errors: FieldErrors = { ...("errors" in named ? { authorName: named.errors } : {}), ...(bodyErrors(body).length ? { body: bodyErrors(body) } : {}) };
      if ("errors" in named || errors.body) return Promise.resolve({ ok: false, errors });
      if (!view.threads.some((thread) => thread.id === threadId)) return Promise.resolve({ ok: false, errors: { body: ["This comment thread does not exist"] } });
      const threads = view.threads.map((thread) => (thread.id === threadId ? { ...thread, comments: [...thread.comments, comment(named.name, body)] } : thread));
      return Promise.resolve(write({ threads, displayName: named.name }));
    },
    setStatus(threadId, status) {
      const view = read();
      if (!view.threads.some((thread) => thread.id === threadId)) return Promise.resolve({ ok: false, errors: { body: ["This comment thread does not exist"] } });
      return Promise.resolve(write({ ...view, threads: view.threads.map((thread) => (thread.id === threadId ? { ...thread, status } : thread)) }));
    },
  };
}
