/*
 * Settings' theme switch for applications built with Salt
 * (restore-toolbar-tools-and-branch-previews, design decision 9). Salt's
 * root provider puts its theme classes, `salt-density-<density>`, and
 * `data-mode` on the document's root element, and a nested provider on its
 * own element; the next theme adds `data-accent` and `data-corner`. The
 * switch finds every such element in the framed page, records what the
 * application gave it, and sets the choice; an observer in the page's realm
 * puts the choice back when the application renders its providers again,
 * and choosing the application's own restores what was recorded. It changes
 * Salt's styles only: code that reads the theme from JavaScript keeps the
 * application's.
 */

export const MODES = ["light", "dark"] as const;
export const DENSITIES = ["high", "medium", "low", "touch"] as const;
export const ACCENTS = ["blue", "teal"] as const;
export const CORNERS = ["sharp", "rounded"] as const;

/** A choice for each of Salt's settings; one left out is the application's own. */
export interface ThemeChoice {
  readonly mode?: (typeof MODES)[number];
  readonly density?: (typeof DENSITIES)[number];
  readonly accent?: (typeof ACCENTS)[number];
  readonly corner?: (typeof CORNERS)[number];
}

/** Salt's provider elements: the root and every nested provider. */
export const PROVIDER_SELECTOR = ".salt-theme, .salt-theme-next";
const DENSITY_CLASS = /^salt-density-/;

/** Whether +choice+ changes anything. */
export function choosesTheme(choice: ThemeChoice): boolean {
  return Boolean(choice.mode || choice.density || choice.accent || choice.corner);
}

const pick = <T extends string>(allowed: readonly T[], value: unknown): T | undefined => (allowed.includes(value as T) ? (value as T) : undefined);

/** A stored or shared choice, keeping only the settings and values Salt has, so anything else reads as the application's own. */
export function parseThemeChoice(value: unknown): ThemeChoice {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const choice = { mode: pick(MODES, raw.mode), density: pick(DENSITIES, raw.density), accent: pick(ACCENTS, raw.accent), corner: pick(CORNERS, raw.corner) };
  return Object.fromEntries(Object.entries(choice).filter(([, setting]) => setting !== undefined)) as ThemeChoice;
}

/** What the application gave a provider element, before any choice was set on it. */
interface Recorded {
  readonly mode: string | null;
  readonly density: readonly string[];
  readonly accent: string | null;
  readonly corner: string | null;
}

function setAttribute(element: Element, name: string, value: string | null): void {
  if (element.getAttribute(name) === value) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function setDensity(element: Element, density: readonly string[]): void {
  const current = [...element.classList].filter((name) => DENSITY_CLASS.test(name));
  if (current.length === density.length && current.every((name) => density.includes(name))) return;
  element.classList.remove(...current);
  element.classList.add(...density);
}

export interface ThemeSwitch {
  /** Sets +choice+ on every provider element, and restores the application's own for each setting it leaves out. */
  update(choice: ThemeChoice): void;
  /** Restores what the application gave every provider element, and stops keeping the choice. */
  stop(): void;
}

/** The theme switch on +document+, a framed page, starting with +choice+. */
export function themeSwitch(document: Document, choice: ThemeChoice): ThemeSwitch {
  const view = document.defaultView as (Window & typeof globalThis) | null;
  const recorded = new Map<Element, Recorded>();
  let current = choice;

  const apply = (element: Element) => {
    if (!recorded.has(element)) {
      recorded.set(element, {
        mode: element.getAttribute("data-mode"),
        density: [...element.classList].filter((name) => DENSITY_CLASS.test(name)),
        accent: element.getAttribute("data-accent"),
        corner: element.getAttribute("data-corner"),
      });
    }
    if (current.mode) setAttribute(element, "data-mode", current.mode);
    if (current.density) setDensity(element, [`salt-density-${current.density}`]);
    if (element.classList.contains("salt-theme-next")) {
      if (current.accent) setAttribute(element, "data-accent", current.accent);
      if (current.corner) setAttribute(element, "data-corner", current.corner);
    }
  };
  const applyAll = () => {
    // Elements the page dropped are forgotten; the rest, and any new provider, get the choice.
    for (const element of [...recorded.keys()]) if (!element.isConnected) recorded.delete(element);
    for (const element of document.querySelectorAll(PROVIDER_SELECTOR)) apply(element);
  };
  const restore = (settings: { mode: boolean; density: boolean; accent: boolean; corner: boolean }) => {
    for (const [element, original] of recorded) {
      if (settings.mode) setAttribute(element, "data-mode", original.mode);
      if (settings.density) setDensity(element, original.density);
      if (settings.accent) setAttribute(element, "data-accent", original.accent);
      if (settings.corner) setAttribute(element, "data-corner", original.corner);
    }
  };

  // The page's own observer, from its realm, sees the application render its providers again.
  const Observer = view?.MutationObserver ?? MutationObserver;
  const observer = new Observer(() => {
    if (choosesTheme(current)) applyAll();
  });
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-mode", "data-accent", "data-corner"] });
  if (choosesTheme(current)) applyAll();

  return {
    update(choice) {
      const previous = current;
      current = choice;
      restore({ mode: Boolean(previous.mode && !choice.mode), density: Boolean(previous.density && !choice.density), accent: Boolean(previous.accent && !choice.accent), corner: Boolean(previous.corner && !choice.corner) });
      if (choosesTheme(choice)) applyAll();
    },
    stop() {
      observer.disconnect();
      restore({ mode: true, density: true, accent: true, corner: true });
      recorded.clear();
    },
  };
}

/** Whether +document+ uses Salt's next theme, which also offers Accent and Corner. */
export function usesNextTheme(document: Document | null): boolean {
  return Boolean(document?.querySelector(".salt-theme-next"));
}
