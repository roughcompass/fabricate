/*
 * The view worker's request log (add-mock-sets, design decision 2): the
 * worker tells the toolbar about each API call it handles for a view that
 * applies a mock set, on a BroadcastChannel only Frontend Registry pages
 * listen on, never by posting to the page's clients, whose own `message`
 * listeners would receive it. The frame agent names its page to the worker
 * that controls it, so each entry carries the page it came from, and a tab
 * lists only its own frame's calls.
 */

/** The channel's name, and the tag of the frame agent's message naming its page. */
export const MOCKS_CHANNEL = "frontend-registry:mocks";

/** The frame agent's message to the Frontend Registry's worker that controls its page. */
export interface PageAnnouncement {
  readonly type: typeof MOCKS_CHANNEL;
  readonly page: string;
}

export function isPageAnnouncement(data: unknown): data is PageAnnouncement {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === MOCKS_CHANNEL && typeof (data as { page?: unknown }).page === "string";
}

/**
 * What happened to a call: a rule answered it; it went to its own address
 * and was answered there; the set answered it as not mocked; or it went to
 * its own address and failed there, with a status of 400 or more or no
 * answer at all.
 */
export type CallOutcome = "mocked" | "passed" | "not-matched" | "failed";

/** What a failed call couldn't do, when no status came back: the worker can't tell a CORS refusal from a failure to connect. */
export const CONNECT_ERROR = "Couldn't connect or was blocked by CORS";

/** One API call the worker handled for a view applying a set. */
export interface LoggedCall {
  readonly type: typeof MOCKS_CHANNEL;
  /** Unique among the worker's entries. */
  readonly id: string;
  /** The view's key (viewId), and the frame agent's id for the page that made the call, when it told the worker. */
  readonly view: string;
  readonly page: string | null;
  readonly method: string;
  readonly url: string;
  readonly outcome: CallOutcome;
  /** The rule that answered, and which of its responses, from 1. */
  readonly rule: { readonly id: string; readonly label: string; readonly response: number } | null;
  /** The status answered; null when none came back. */
  readonly status: number | null;
  readonly error: string | null;
  /** When the call was made, in milliseconds since the epoch, and how long it took to answer. */
  readonly at: number;
  readonly durationMs: number;
  /** The request's body, up to 64 KB, for a call that wasn't matched or that failed, so a rule can be made from it. */
  readonly body: string | null;
  /** The set and revision that applied. */
  readonly set: string;
  readonly revision: number;
}

export function isLoggedCall(data: unknown): data is LoggedCall {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === MOCKS_CHANNEL && typeof (data as { outcome?: unknown }).outcome === "string";
}
