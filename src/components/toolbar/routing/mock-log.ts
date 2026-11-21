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
