"use client";

import { createContext, use, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Rect } from "@/components/toolbar/placement";
import { AgentChannel, browserScheduler, fetchAgentText, injectAgent, runAgent, watchDocuments } from "./frame-agent";
import { type InspectorMessage, isInspectorMessage, registryOf } from "./inspector/protocol";

/**
 * The document the toolbar's tools inspect (add-applications, design decision
 * 6): a running application's own page in a same-origin frame, never the
 * Frontend Registry page around it. Every tool reads the frame's window and
 * document from here, follows its route, and maps what it measures in the
 * frame onto the page the toolbar draws on.
 *
 * Only same-origin frames can be read, which holds because builds are served
 * from the Frontend Registry's own origin under /previews/. A frame that can't
 * be read leaves the state "unreadable", and the toolbar says so instead of
 * starting.
 *
 * The frame opens its first address only once the page is ready for it
 * (restore-toolbar-tools-and-branch-previews, design decisions 6 to 8): the
 * frame agent's text has been fetched, so it can run in the new document at
 * once, and every preload step a tool added has run, such as applying a
 * session preset or arming version routing. Reloads a tool asks for run them
 * again.
 */

/** A step that runs before the frame loads a document the toolbar opens: its first, and each reload. It returns the address to open, changed or as it was. */
export type Preload = (address: string) => string | Promise<string>;

export type TargetState = "loading" | "ready" | "unreadable";

export interface TargetDocument {
  readonly frame: HTMLIFrameElement | null;
  /** The framed page's window and document, from its latest load; null until it loads, or while it can't be read. */
  readonly window: Window | null;
  readonly document: Document | null;
  readonly state: TargetState;
  /** Where the build is served, with its slash: `/previews/<preview>/`. */
  readonly base: string;
  /** The commit of the build the frame shows. */
  readonly commit: string;
  /** The application route the frame shows, relative to the base: `/accounts/42`. */
  readonly route: string;
  /** The query of the frame's page, with its `?`, such as `?tab=billing`, or empty. Comments bind to the route alone. */
  readonly search: string;
  /** Counts every change of page: each load of a document in the frame, and each route change within one. */
  readonly changes: number;
  /** Opens +route+ in the frame, as a navigation of its own page. */
  navigate(route: string): void;
  /**
   * Opens +address+, a route with its query under the base, or the route
   * and query shown now, in the frame again, after every preload step has
   * run, replacing the frame's history entry.
   */
  reload(address?: string): void;
  /** Adds a step that runs before each document the toolbar opens in the frame; returns a function that removes it. */
  addPreload(step: Preload): () => void;
  /** The frame agent's id for the page shown, once it runs there; every message it posts carries it. */
  readonly page: string | null;
  /** The frame agent's messages, by page (useAgentMessages). */
  readonly channel: AgentChannel;
  /** A rectangle in the frame's viewport, in the coordinates of the page around it. */
  toParent(rect: Rect): Rect;
  /** The part of the page around it that the frame shows. */
  viewport(): Rect;
}

const TargetDocumentContext = createContext<TargetDocument | null>(null);

export function useTargetDocument(): TargetDocument {
  const target = use(TargetDocumentContext);
  if (!target) throw new Error("useTargetDocument must be used inside a TargetFrame");
  return target;
}

/** The target document, when the toolbar runs over a frame; null otherwise. */
export function useOptionalTargetDocument(): TargetDocument | null {
  return use(TargetDocumentContext);
}

/** The route of +pathname+ under +base+: `/previews/p/accounts` under `/previews/p/` is `/accounts`. */
export function routeOf(pathname: string, base: string): string {
  if (pathname === base.slice(0, -1)) return "/";
  return pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : pathname;
}

/** The address of +route+ under +base+. */
export function addressOf(route: string, base: string): string {
  return `${base}${route.replace(/^\/+/, "")}`;
}

/** The frame's window, when its document has loaded and can be read: same origin, and not the initial blank page. */
function readable(frame: HTMLIFrameElement): Window | null {
  try {
    const view = frame.contentWindow;
    const document = frame.contentDocument;
    if (!view || !document || view.location.href === "about:blank") return null;
    return view;
  } catch {
    return null;
  }
}

/** Whether the frame still shows its initial blank page, before its first address opens. */
function blank(frame: HTMLIFrameElement): boolean {
  try {
    return !frame.contentWindow || frame.contentWindow.location.href === "about:blank";
  } catch {
    return false;
  }
}

interface NavigationTarget extends EventTarget {
  addEventListener(type: "currententrychange", listener: () => void): void;
  removeEventListener(type: "currententrychange", listener: () => void): void;
}

/**
 * Calls +changed+ whenever the page in +view+ changes its address without
 * loading another document: through the Navigation API where the browser has
 * it, which sees every history change; otherwise by wrapping the history
 * methods applications navigate with. Returns a function that stops.
 */
function followAddress(view: Window, changed: () => void): () => void {
  view.addEventListener("popstate", changed);
  view.addEventListener("hashchange", changed);
  const removeEvents = () => {
    view.removeEventListener("popstate", changed);
    view.removeEventListener("hashchange", changed);
  };
  const navigation = (view as Window & { navigation?: NavigationTarget }).navigation;
  if (navigation) {
    navigation.addEventListener("currententrychange", changed);
    return () => {
      removeEvents();
      navigation.removeEventListener("currententrychange", changed);
    };
  }
  const history = view.history;
  const { pushState, replaceState } = history;
  const wrapped = (original: History["pushState"]): History["pushState"] =>
    function (this: History, ...args) {
      original.apply(this, args);
      changed();
    };
  history.pushState = wrapped(pushState);
  history.replaceState = wrapped(replaceState);
  return () => {
    removeEvents();
    history.pushState = pushState;
    history.replaceState = replaceState;
  };
}

interface Loaded {
  readonly window: Window;
  readonly document: Document;
}

/**
 * Opens documents in the frame for the toolbar: it runs the preload steps on
 * an address, then opens what they return, with the watcher armed for the
 * new document. A load started later supersedes one still running its steps.
 */
class FrameOpener {
  private frame: HTMLIFrameElement | null = null;
  private watcher: ReturnType<typeof watchDocuments> | null = null;
  private preloads: Preload[] = [];
  private loads = 0;

  attach(frame: HTMLIFrameElement | null, watcher: ReturnType<typeof watchDocuments> | null): void {
    this.frame = frame;
    this.watcher = watcher;
  }

  readonly addPreload = (step: Preload): (() => void) => {
    this.preloads = [...this.preloads, step];
    return () => {
      this.preloads = this.preloads.filter((each) => each !== step);
    };
  };

  check(): void {
    this.watcher?.check();
  }

  async open(address: string): Promise<void> {
    const load = ++this.loads;
    let next = address;
    for (const step of [...this.preloads]) next = await step(next);
    const frame = this.frame;
    if (load !== this.loads || !frame) return;
    this.watcher?.arm();
    const view = readable(frame);
    if (view) view.location.replace(next);
    else frame.src = next;
  }
}

/**
 * A running application's page in a same-origin frame, with the target
 * document its tools inspect. +src+ is the frame's first address; after that
 * the page keeps its own, and `navigate` moves it. The children, such as the
 * toolbar, render beside the frame.
 */
export function TargetFrame({ src, base, commit, title, className, children }: { src: string; base: string; commit: string; title: string; className?: string; children: React.ReactNode }) {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [state, setState] = useState<TargetState>("loading");
  const [route, setRoute] = useState(() => routeOf(new URL(src, "http://localhost").pathname, base));
  const [search, setSearch] = useState(() => new URL(src, "http://localhost").search);
  const [changes, setChanges] = useState(0);
  const [page, setPage] = useState<string | null>(null);
  const [channel] = useState(() => new AgentChannel());
  // The frame's first address; React never sets it, so it can't move the frame back when the page navigates.
  const [initialSrc] = useState(src);
  const current = useRef(`${route}${search}`);
  const [opener] = useState(() => new FrameOpener());

  // The agent's messages, from this frame's window, on this origin only.
  useEffect(() => {
    if (!frame) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== window.location.origin || !isInspectorMessage(event.data)) return;
      channel.push(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, channel]);

  // Early attach: the agent runs in each new document as soon as it exists, then the first address opens.
  useEffect(() => {
    if (!frame) return;
    let text: string | null = null;
    let live = true;
    const watch = watchDocuments(
      frame,
      (view) => {
        if (text) runAgent(view, text);
        const registry = registryOf(view);
        if (registry) setPage(registry.page);
      },
      browserScheduler(),
    );
    opener.attach(frame, watch);
    void fetchAgentText().then((agent) => {
      text = agent;
      if (live) void opener.open(initialSrc);
    });
    return () => {
      live = false;
      watch.stop();
      opener.attach(null, null);
    };
  }, [frame, initialSrc, opener]);

  // A change of the query alone, such as a tab kept in it, is a change of page too.
  const follow = useEffectEvent((view: Window) => {
    const next = routeOf(view.location.pathname, base);
    if (`${next}${view.location.search}` === current.current) return;
    current.current = `${next}${view.location.search}`;
    setRoute(next);
    setSearch(view.location.search);
    setChanges((count) => count + 1);
  });

  useEffect(() => {
    if (!frame) return;
    let stop = () => {};
    const attach = () => {
      // The initial blank page loads before the first address opens.
      if (blank(frame)) return;
      stop();
      stop = () => {};
      const view = readable(frame);
      if (!view) {
        setLoaded(null);
        setState("unreadable");
        return;
      }
      opener.check();
      // Load's fallback, when the agent couldn't run early.
      const registry = registryOf(view);
      if (registry) setPage(registry.page);
      else injectAgent(view.document, () => setPage(registryOf(view)?.page ?? null));
      const loadedRoute = routeOf(view.location.pathname, base);
      current.current = `${loadedRoute}${view.location.search}`;
      setRoute(loadedRoute);
      setSearch(view.location.search);
      setLoaded({ window: view, document: view.document });
      setState("ready");
      setChanges((count) => count + 1);
      stop = followAddress(view, () => follow(view));
    };
    frame.addEventListener("load", attach);
    // A page that finished loading before this effect ran.
    if (frame.contentDocument?.readyState === "complete" && readable(frame)) attach();
    return () => {
      frame.removeEventListener("load", attach);
      stop();
    };
  }, [frame, base, opener]);

  const toParent = (rect: Rect): Rect => {
    if (!frame) return rect;
    const box = frame.getBoundingClientRect();
    // A frame scaled by a transform scales what it shows.
    const scale = frame.offsetWidth > 0 ? box.width / frame.offsetWidth : 1;
    return { top: box.top + (frame.clientTop + rect.top) * scale, left: box.left + (frame.clientLeft + rect.left) * scale, width: rect.width * scale, height: rect.height * scale };
  };

  const target: TargetDocument = {
    frame,
    window: loaded?.window ?? null,
    document: loaded?.document ?? null,
    state,
    base,
    commit,
    route,
    search,
    changes,
    navigate(next) {
      loaded?.window.location.assign(addressOf(next, base));
    },
    reload(address) {
      const target = new URL(address ?? `${route}${search}`, "http://localhost");
      void opener.open(`${addressOf(target.pathname, base)}${target.search}`);
    },
    addPreload: opener.addPreload,
    page,
    channel,
    toParent,
    viewport: () => (frame ? toParent({ top: 0, left: 0, width: frame.clientWidth, height: frame.clientHeight }) : { top: 0, left: 0, width: 0, height: 0 }),
  };

  return (
    <TargetDocumentContext value={target}>
      <iframe ref={setFrame} title={title} className={className} data-target-frame="" />
      {children}
    </TargetDocumentContext>
  );
}

/**
 * Calls +listener+ with every message the frame agent posted from the page
 * shown, those it sent before this was called first, then each new one, and
 * starts over with the next page.
 */
export function useAgentMessages(listener: (message: InspectorMessage) => void): string | null {
  const { channel, page } = useTargetDocument();
  const onMessage = useEffectEvent(listener);
  useEffect(() => (page ? channel.subscribe(page, (message) => onMessage(message)) : undefined), [channel, page]);
  return page;
}

/** Adds +step+ to the steps that run before each document the toolbar opens in the frame, while mounted. */
export function usePreload(step: Preload): void {
  const { addPreload } = useTargetDocument();
  const run = useEffectEvent((address: string) => step(address));
  useEffect(() => addPreload((address) => run(address)), [addPreload]);
}

const EMPTY = new Map<never, Rect>();

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function sameRects<K>(a: ReadonlyMap<K, Rect>, b: ReadonlyMap<K, Rect>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, rect] of a) {
    const other = b.get(key);
    if (!other || other.top !== rect.top || other.left !== rect.left || other.width !== rect.width || other.height !== rect.height) return false;
  }
  return true;
}

/**
 * Tracks where the elements `collect` finds in the target document are, by
 * key, in the coordinates of the page around the frame, while `active`. They
 * are measured again, at most once a frame, when either page scrolls or
 * resizes, the frame moves, or the framed document changes. Change `revision`
 * whenever `collect` would find different elements.
 */
export function useTargetRects<K extends string>(collect: (document: Document) => ReadonlyMap<K, Element>, active: boolean, revision: unknown = null): ReadonlyMap<K, Rect> {
  const target = useTargetDocument();
  const [rects, setRects] = useState<ReadonlyMap<K, Rect>>(() => new Map());
  const measure = useEffectEvent(() => {
    const next = new Map<K, Rect>();
    if (target.document) for (const [key, element] of collect(target.document)) if (element.isConnected) next.set(key, target.toParent(rectOf(element)));
    // A change in the page that moved nothing renders nothing.
    setRects((current) => (sameRects(current, next) ? current : next));
  });
  const { window: view, document, frame } = target;

  useEffect(() => {
    if (!active || !view || !document || !frame) return;
    let scheduled = 0;
    const schedule = () => {
      if (scheduled) return;
      scheduled = window.requestAnimationFrame(() => {
        scheduled = 0;
        measure();
      });
    };
    schedule();
    for (const source of [window, view]) {
      source.addEventListener("scroll", schedule, true);
      source.addEventListener("resize", schedule);
    }
    // The framed document's own observers, from its realm.
    const frameRealm = view as Window & typeof globalThis;
    const mutations = new frameRealm.MutationObserver(schedule);
    mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const inner = new frameRealm.ResizeObserver(schedule);
    inner.observe(document.documentElement);
    const outer = new ResizeObserver(schedule);
    outer.observe(frame);
    return () => {
      if (scheduled) window.cancelAnimationFrame(scheduled);
      for (const source of [window, view]) {
        source.removeEventListener("scroll", schedule, true);
        source.removeEventListener("resize", schedule);
      }
      mutations.disconnect();
      inner.disconnect();
      outer.disconnect();
    };
  }, [active, revision, view, document, frame]);

  return active ? rects : EMPTY;
}
