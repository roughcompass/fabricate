import { INSPECTOR_SCRIPT, type InspectorMessage, registryOf } from "./inspector/protocol";

/*
 * Running the frame agent (inspector/inspector.ts) in each document a
 * running application's frame loads, as early as it can
 * (restore-toolbar-tools-and-branch-previews, design decision 6), and the
 * channel its messages arrive on.
 *
 * Early attach: when the frame starts a navigation, the toolbar looks for
 * the frame's new document on every animation frame and every task until it
 * exists, then runs the agent in that document's realm at once, through the
 * realm's own Function constructor, with the agent's text fetched once. That
 * runs before the page's deferred and module scripts, where Vite, Rspack,
 * and webpack builds start; a blocking script earlier in its head can still
 * run first. Adding the agent as a script on load stays as the fallback, and
 * the agent installs itself only once per page.
 */

/** What the watcher reads of an iframe: its window and document, which a navigation replaces. */
export interface WatchedFrame {
  readonly contentWindow: Window | null;
  readonly contentDocument: Document | null;
}

/** How the watcher schedules its checks: on animation frames and on tasks, each cancellable. */
export interface Scheduler {
  frame(callback: () => void): () => void;
  task(callback: () => void): () => void;
  now(): number;
}

/** How long a navigation may take to produce its document before the watcher gives up; load still attaches. */
const WATCH_MS = 15_000;

export const browserScheduler = (): Scheduler => ({
  frame(callback) {
    const handle = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(handle);
  },
  task(callback) {
    // A message to itself runs as the next task, sooner than a timer's 4 ms clamp.
    const channel = new MessageChannel();
    let live = true;
    channel.port1.onmessage = () => {
      if (live) callback();
      channel.port1.close();
    };
    channel.port2.postMessage(null);
    return () => {
      live = false;
      channel.port1.close();
    };
  },
  now: () => performance.now(),
});

/** The frame's document, when it can be read and isn't the initial blank page. */
function readableDocument(frame: WatchedFrame): { view: Window; document: Document } | null {
  try {
    const view = frame.contentWindow;
    const document = frame.contentDocument;
    if (!view || !document || view.location.href === "about:blank") return null;
    return { view, document };
  } catch {
    return null;
  }
}

/**
 * Runs the agent, from its +text+, in +view+'s realm, unless it already runs
 * there. Its own Function constructor gives the code that realm's globals.
 * Returns whether it ran; a page whose policy forbids it is left to load's
 * fallback.
 */
export function runAgent(view: Window, text: string): boolean {
  if (registryOf(view)) return false;
  try {
    const RealmFunction = (view as Window & typeof globalThis).Function;
    new RealmFunction(text)();
    return true;
  } catch {
    return false;
  }
}

/**
 * Watches +frame+ for each new document and calls +found+ with it once, as
 * soon as it's seen. `arm` starts looking, as a navigation starts; a found
 * document's window is watched for leaving, which arms it again. Returns
 * `arm` and `stop`.
 */
export function watchDocuments(frame: WatchedFrame, found: (view: Window, document: Document) => void, scheduler: Scheduler): { arm(): void; check(): void; stop(): void } {
  let known: Document | null = null;
  let until = 0;
  let searching = false;
  let cancels: (() => void)[] = [];
  let unlisten = () => {};

  const cancel = () => {
    for (const each of cancels) each();
    cancels = [];
  };
  const check = () => {
    const current = readableDocument(frame);
    if (!current || current.document === known) return false;
    known = current.document;
    unlisten();
    const leaving = () => arm();
    // Leaving the page starts the next navigation; listening on the window it leaves.
    current.view.addEventListener("beforeunload", leaving);
    current.view.addEventListener("pagehide", leaving);
    unlisten = () => {
      try {
        current.view.removeEventListener("beforeunload", leaving);
        current.view.removeEventListener("pagehide", leaving);
      } catch {
        // A window that went away holds no listeners.
      }
    };
    found(current.view, current.document);
    return true;
  };
  const loop = () => {
    cancel();
    if (!searching) return;
    if (check() || scheduler.now() > until) {
      searching = false;
      return;
    }
    cancels = [scheduler.frame(loop), scheduler.task(loop)];
  };
  const arm = () => {
    until = scheduler.now() + WATCH_MS;
    searching = true;
    loop();
  };
  return {
    arm,
    check: () => void check(),
    stop() {
      searching = false;
      cancel();
      unlisten();
    },
  };
}

let agentText: Promise<string | null> | null = null;

/** The agent's text, fetched once per page; null when it can't be, which leaves attaching to load's fallback. */
export function fetchAgentText(): Promise<string | null> {
  agentText ??= fetch(INSPECTOR_SCRIPT)
    .then((response) => (response.ok ? response.text() : null))
    .catch(() => null);
  return agentText;
}

/** Adds the agent to +document+ as a script, load's fallback; calls +added+ once it ran. */
export function injectAgent(document: Document, added: () => void): void {
  if (document.querySelector("script[data-frontend-registry-inspector]")) return;
  const script = document.createElement("script");
  script.src = INSPECTOR_SCRIPT;
  script.dataset.frontendRegistryInspector = "";
  script.addEventListener("load", added);
  (document.head ?? document.documentElement).append(script);
}

/** Messages kept for a page, so a tool that starts listening late still sees the page's earliest. */
const BUFFER_LIMIT = 5000;
/** Pages whose messages are kept: the one shown, and those just before it. */
const PAGE_LIMIT = 3;

type Listener = (message: InspectorMessage) => void;

/**
 * The agent's messages, by the page they came from. A tool subscribes to a
 * page and gets every message that page has sent so far, then each new one,
 * so none is lost to the order in which a new document, its messages, and
 * the tools' renders arrive.
 */
export class AgentChannel {
  private readonly pages = new Map<string, InspectorMessage[]>();
  private readonly listeners = new Map<string, Set<Listener>>();

  push(message: InspectorMessage): void {
    let buffer = this.pages.get(message.page);
    if (!buffer) {
      buffer = [];
      this.pages.set(message.page, buffer);
      while (this.pages.size > PAGE_LIMIT) this.pages.delete(this.pages.keys().next().value!);
    }
    buffer.push(message);
    if (buffer.length > BUFFER_LIMIT) buffer.shift();
    for (const listener of this.listeners.get(message.page) ?? []) listener(message);
  }

  subscribe(page: string, listener: Listener): () => void {
    for (const message of this.pages.get(page) ?? []) listener(message);
    const set = this.listeners.get(page) ?? new Set();
    set.add(listener);
    this.listeners.set(page, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(page);
    };
  }
}
