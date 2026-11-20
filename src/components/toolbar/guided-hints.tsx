"use client";

import { createContext, use, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type HintAction, type HintSequence, type HintState, hintsShown, nextHints } from "@/lib/workspaces/hints";
import { PLACEMENT_MARGIN, type Rect, type Size, placeOutside } from "./placement";
import { ToolbarContext } from "./toolbar-context";
import { useToolbarBounds } from "./toolbar-bounds";
import styles from "./hints.module.css";

/**
 * Guided hints for self-serve visitors (template-demo/demo-mode spec): a short
 * sequence of dismissible hints, each pointing at a part of the page. Finishing
 * or dismissing a sequence is remembered for the workspace, and a visitor can
 * replay the hints or turn them off, in the toolbar's Preferences.
 */

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

export interface Hint {
  /** The element the hint points at. */
  readonly target: string;
  readonly title: string;
  readonly text: string;
  /**
   * Where the hint sits relative to its target. A hint to the left points into
   * the toolbar menu, which the sequence opens, and is placed clear of the
   * toolbar's controls.
   */
  readonly placement: "above" | "below" | "left";
}

/** Where the workspace's hint state is stored (src/app/api/workspace/hints). */
const HINTS_ENDPOINT = "/api/workspace/hints";

function postHints(action: HintAction, sequence?: HintSequence): Promise<HintState | null> {
  // keepalive: a visitor may dismiss the hints and leave the page at once.
  return fetch(HINTS_ENDPOINT, { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ action, sequence }) })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { hints: HintState } | null) => data?.hints ?? null)
    .catch(() => null);
}

export interface HintControls {
  readonly state: HintState;
  /** Increments on each replay, so a sequence starts again from its first hint. */
  readonly replays: number;
  act(action: HintAction, sequence?: HintSequence): void;
}

/** The workspace's hint state in the browser: applied at once, and stored for the workspace. */
export function useHintControls(initial: HintState): HintControls {
  const [state, setState] = useState(initial);
  const [replays, setReplays] = useState(0);
  return {
    state,
    replays,
    act(action, sequence) {
      const next = nextHints(state, action, sequence);
      if (!next) return;
      setState(next);
      if (action === "replay") setReplays((count) => count + 1);
      void postHints(action, sequence).then((stored) => {
        if (stored) setState(stored);
      });
    },
  };
}

export const HintsContext = createContext<HintControls | null>(null);

export function useHints(): HintControls | null {
  return use(HintsContext);
}

const WIDTH = 300;
/** Room a hint card needs, for keeping it on screen. */
const CARD_HEIGHT = 200;

/** Whether a menu item lies partly outside the visible part of the menu's list. */
function clipped(element: Element): boolean {
  const list = element.closest('[role="listbox"]');
  if (!list) return false;
  const [item, view] = [element.getBoundingClientRect(), list.getBoundingClientRect()];
  return item.top < view.top || item.bottom > view.bottom;
}

/** One sequence of hints, shown while hints are on and the sequence is not finished. */
export function GuidedHints({ sequence, hints, controls }: { sequence: HintSequence; hints: readonly Hint[]; controls: HintControls }) {
  return hintsShown(controls.state, sequence) ? <HintSequenceView key={controls.replays} sequence={sequence} hints={hints} onFinish={() => controls.act("done", sequence)} /> : null;
}

function HintSequenceView({ sequence, hints, onFinish }: { sequence: HintSequence; hints: readonly Hint[]; onFinish: () => void }) {
  const toolbar = use(ToolbarContext);
  const [step, setStep] = useState(0);
  const [layout, setLayout] = useState<{ rect: Rect; width: number; height: number } | null>(null);
  // Whether this sequence opened the toolbar menu, so dismissing it closes the menu only then.
  const openedMenu = useRef(false);
  const hint = hints[step];
  const inMenu = hint?.placement === "left";
  const menuOpen = toolbar?.menuOpen ?? false;

  // The target is scrolled into view the first time it is found, and again whenever the menu's list hides it.
  const revealed = useRef(-1);
  const measure = useEffectEvent(() => {
    const element = hint ? document.querySelector(hint.target) : null;
    if (element && (revealed.current !== step || clipped(element))) {
      revealed.current = step;
      element.scrollIntoView({ block: "nearest" });
    }
    setLayout(element ? { rect: rectOf(element), width: document.documentElement.clientWidth, height: window.innerHeight } : null);
  });

  // A hint in the menu opens it when the hint appears; a visitor who closes it keeps it closed.
  const openMenu = useEffectEvent(() => {
    if (!inMenu || !toolbar || toolbar.menuOpen) return;
    openedMenu.current = true;
    toolbar.openMenu();
  });
  useEffect(() => openMenu(), [step]);

  useEffect(() => {
    let frame = window.requestAnimationFrame(() => measure());
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => measure());
    };
    // Targets can appear a moment later, as when the menu opens, so keep looking for a moment.
    const retry = window.setInterval(schedule, 250);
    const stop = window.setTimeout(() => window.clearInterval(retry), 4000);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(retry);
      window.clearTimeout(stop);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [step, menuOpen]);

  const finish = () => {
    if (openedMenu.current && toolbar?.menuOpen) toolbar.closeMenu();
    toolbar?.setMenuRoom(0);
    onFinish();
  };

  // Shown once its target has been measured, which also keeps it out of the server render.
  if (!hint || !layout) return null;
  const last = step === hints.length - 1;
  const label = `Hint ${step + 1} of ${hints.length}: ${hint.title}`;
  const body = (
    <>
      <p className={styles.step}>{`Hint ${step + 1} of ${hints.length}`}</p>
      <h2 className={styles.title}>{hint.title}</h2>
      <p className={styles.text}>{hint.text}</p>
      <div className={styles.actions}>
        <Button size="sm" variant="tertiary" onClick={finish}>
          Dismiss hints
        </Button>
        {last ? (
          <Button size="sm" variant="primary" onClick={finish}>
            Finish hints
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setStep((current) => current + 1)}>
            Next hint
          </Button>
        )}
      </div>
    </>
  );

  if (hint.placement === "left") {
    return (
      <MenuHint key={step} rect={layout.rect} viewport={layout} label={label} sequence={sequence}>
        {body}
      </MenuHint>
    );
  }

  const { rect } = layout;
  const width = Math.min(WIDTH, layout.width - 24);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), layout.width - width - 12);
  // Below the target, or above it when there is no room below; always on screen.
  const below = Math.min(rect.top + rect.height + 12, layout.height - CARD_HEIGHT - 12);
  const position = hint.placement === "above" ? { left, bottom: Math.min(layout.height - rect.top + 12, layout.height - CARD_HEIGHT - 12) } : { left, top: Math.max(12, below) };

  return (
    <div className={styles.hint} style={{ ...position, width }} role="dialog" aria-label={label} data-hint={sequence} data-toolbar="hint">
      {body}
    </div>
  );
}

/**
 * A hint pointing at a toolbar menu item: to the left of the item, clear of
 * the pill and the menu (template-demo/demo-mode spec). When nothing beside
 * the menu is free, as on a phone, it asks the menu to leave room below
 * itself, and sits there.
 */
function MenuHint({ rect, viewport, label, sequence, children }: { rect: Rect; viewport: Size; label: string; sequence: HintSequence; children: React.ReactNode }) {
  const toolbar = use(ToolbarContext);
  const exclusions = useToolbarBounds();
  const card = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  const width = Math.min(WIDTH, viewport.width - 2 * PLACEMENT_MARGIN);

  useLayoutEffect(() => {
    const node = card.current;
    if (!node) return;
    const observe = () => setBox((current) => (current && current.width === node.offsetWidth && current.height === node.offsetHeight ? current : { width: node.offsetWidth, height: node.offsetHeight }));
    observe();
    const observer = new ResizeObserver(observe);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const position = box ? placeOutside(box, { left: rect.left - PLACEMENT_MARGIN - box.width, top: rect.top + rect.height / 2 - box.height / 2 }, exclusions, viewport) : null;
  // Room is decided by width alone, which the room itself doesn't change: none when the hint fits left of the toolbar.
  const fitsLeft = !exclusions.length || Math.min(...exclusions.map((exclusion) => exclusion.left)) - 2 * PLACEMENT_MARGIN >= (box?.width ?? width);
  const room = box && !fitsLeft ? box.height + 2 * PLACEMENT_MARGIN : 0;

  useEffect(() => {
    toolbar?.setMenuRoom(room);
  }, [room, toolbar]);
  useEffect(() => () => toolbar?.setMenuRoom(0), [toolbar]);

  return (
    <div ref={card} className={styles.hint} style={{ width, ...(position ?? { top: 0, left: 0, visibility: "hidden" }) }} role="dialog" aria-label={label} data-hint={sequence} data-toolbar="hint">
      {children}
    </div>
  );
}

const menuItem = (id: string) => `[data-toolbar-menu] [role="option"][data-toolbar-item="${id}"]`;

/** A running application's hints open the toolbar menu and point, in turn, to Accessibility, Timing, and Comment (template-demo/demo-mode spec). */
export const RUNTIME_HINTS: readonly Hint[] = [
  { target: menuItem("accessibility"), title: "Audit accessibility", text: "Run an automated audit on this page and see each problem outlined in place.", placement: "left" },
  { target: menuItem("timing"), title: "See what's slow", text: "Check this page's Web Vitals, the order its files loaded in, and how long each click or key press took.", placement: "left" },
  { target: menuItem("comment"), title: "Comment on anything", text: "Choose any element on the page and leave a comment that stays attached to it.", placement: "left" },
];
