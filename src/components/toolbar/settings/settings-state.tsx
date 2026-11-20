"use client";

import { createContext, use, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { describeValue } from "../inspector/agent-post";
import { type BusEntry, isInspectorMessage, markToolbarEvent } from "../inspector/protocol";
import { useAgentMessages, useTargetDocument } from "../target-document";
import { useToolbarView } from "../view-context";
import { type SendFields, type SendErrors, addEntry, checkSend } from "./bus";
import { type ThemeChoice, type ThemeSwitch, parseThemeChoice, themeSwitch } from "./theme";

/**
 * Settings for a running application (restore-toolbar-tools-and-branch-
 * previews, design decisions 6 and 9): the theme chosen for the view, kept
 * in the browser and set on the framed page while its Profile shows a Salt
 * provider, and the page's event bus log, which starts over with each page
 * the frame loads and is never stored.
 */

interface SettingsState {
  /** Whether the Profile of the build's commit shows the package renders a Salt provider. */
  readonly salt: boolean;
  readonly theme: ThemeChoice;
  setTheme(choice: ThemeChoice): void;
  /** The page's event bus, newest first. */
  readonly bus: readonly BusEntry[];
  clearBus(): void;
  /** Sends an event or message into the page, as the toolbar; or says what to enter. */
  send(fields: SendFields): { ok: true } | { ok: false; errors: SendErrors };
}

const SettingsContext = createContext<SettingsState | null>(null);

export function useSettings(): SettingsState {
  const settings = use(SettingsContext);
  if (!settings) throw new Error("useSettings must be used inside the settings provider");
  return settings;
}

/** Where the browser keeps a view's theme. */
export const themeKey = (view: string) => `frontend-registry:theme:${view}`;

const themeListeners = new Set<() => void>();
const themeCache = new Map<string, { stored: string | null; choice: ThemeChoice }>();
const NO_CHOICE: ThemeChoice = {};

function readTheme(key: string): ThemeChoice {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(key);
  } catch {
    // Without storage, the choice lasts for this page only.
  }
  const cached = themeCache.get(key);
  if (cached && cached.stored === stored) return cached.choice;
  let choice = NO_CHOICE;
  try {
    choice = parseThemeChoice(JSON.parse(stored ?? "{}"));
  } catch {
    // A choice that can't be read is the application's own.
  }
  themeCache.set(key, { stored, choice });
  return choice;
}

function writeTheme(key: string, choice: ThemeChoice): void {
  try {
    if (Object.keys(choice).length) window.localStorage.setItem(key, JSON.stringify(choice));
    else window.localStorage.removeItem(key);
  } catch {
    // Without storage, the choice lasts for this page only.
    themeCache.set(key, { stored: null, choice });
  }
  for (const listener of themeListeners) listener();
}

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

/** The view's theme in the browser, with the setter that keeps it. */
function useStoredTheme(view: string): [ThemeChoice, (choice: ThemeChoice) => void] {
  const key = themeKey(view);
  const choice = useSyncExternalStore(
    subscribeTheme,
    () => readTheme(key),
    () => NO_CHOICE,
  );
  return [choice, (next) => writeTheme(key, next)];
}

/** Keeps +choice+ set on the framed page's Salt providers while +active+, across the page's re-renders and each new page. */
function useThemeSwitch(document: Document | null, active: boolean, choice: ThemeChoice): void {
  const current = useRef<ThemeSwitch | null>(null);
  const latest = useRef(choice);
  useEffect(() => {
    latest.current = choice;
    current.current?.update(choice);
  }, [choice]);
  useEffect(() => {
    if (!document || !active) return;
    const applied = themeSwitch(document, latest.current);
    current.current = applied;
    return () => {
      applied.stop();
      current.current = null;
    };
  }, [document, active]);
}

/** The page's event bus: the agent's entries, and the messages the page posts to this one. */
function useBus(): [readonly BusEntry[], () => void] {
  const { frame, page } = useTargetDocument();
  const [log, setLog] = useState<{ page: string | null; entries: readonly BusEntry[] }>({ page, entries: [] });
  // Another page in the frame starts a new log.
  if (log.page !== page) setLog({ page, entries: [] });

  useAgentMessages((message) => {
    if (message.kind === "bus") setLog((current) => (current.page === message.page ? { ...current, entries: addEntry(current.entries, message.entry) } : current));
  });

  useEffect(() => {
    if (!frame || !page) return;
    let next = 1;
    const onMessage = (event: MessageEvent) => {
      const view = frame.contentWindow;
      if (!view || event.source !== view || event.origin !== window.location.origin || isInspectorMessage(event.data)) return;
      const entry: BusEntry = { id: next++, kind: "posted", name: "message", timeMs: view.performance.now(), detail: describeValue(event.data), from: "application" };
      setLog((current) => (current.page === page ? { ...current, entries: addEntry(current.entries, entry) } : current));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, page]);

  return [log.entries, () => setLog((current) => ({ ...current, entries: [] }))];
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const target = useTargetDocument();
  const view = useToolbarView();
  const salt = view.composition.saltProvider;
  const [theme, setTheme] = useStoredTheme(view.key);
  useThemeSwitch(target.document, salt, theme);
  const [bus, clearBus] = useBus();

  const send = (fields: SendFields): { ok: true } | { ok: false; errors: SendErrors } => {
    const checked = checkSend(fields);
    if (!checked.ok) return checked;
    const page = target.window as (Window & typeof globalThis) | null;
    if (!page) return { ok: false, errors: { detail: ["The application's page hasn't loaded yet. Try again once it has."] } };
    // The detail is made in the page's own realm, as the page's own events' details are.
    const detail = page.JSON.parse(JSON.stringify(checked.detail)) as unknown;
    if (fields.target === "message") page.postMessage(detail, window.location.origin);
    else {
      const event = new page.CustomEvent(checked.name, { detail });
      markToolbarEvent(event);
      (fields.target === "window" ? page : page.document).dispatchEvent(event);
    }
    return { ok: true };
  };

  const state: SettingsState = { salt, theme, setTheme, bus, clearBus, send };
  return <SettingsContext value={state}>{children}</SettingsContext>;
}
