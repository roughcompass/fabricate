"use client";

import { createContext, use, useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { type HintAction, type HintSequence, type HintState, hintsShown, nextHints } from "@/lib/demo/hints";
import { type Rect, rectOf } from "./geometry";
import styles from "./hints.module.css";

/**
 * Guided hints for self-serve visitors (template-demo/demo-mode spec): a short
 * sequence of dismissible hints, each pointing at a part of the page. Finishing
 * or dismissing a sequence is remembered for the workspace, and a visitor can
 * replay the hints or turn them off.
 */

export interface Hint {
  /** The element the hint points at. */
  readonly target: string;
  readonly title: string;
  readonly text: string;
  /** Where the hint sits relative to its target. */
  readonly placement: "above" | "below";
}

function postHints(action: HintAction, sequence?: HintSequence): Promise<HintState | null> {
  // keepalive: a visitor may dismiss the hints and leave the page at once.
  return fetch("/api/demo/hints", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ action, sequence }) })
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

/** One sequence of hints, shown while hints are on and the sequence is not finished. */
export function GuidedHints({ sequence, hints, controls }: { sequence: HintSequence; hints: readonly Hint[]; controls: HintControls }) {
  return hintsShown(controls.state, sequence) ? <HintSequenceView key={controls.replays} sequence={sequence} hints={hints} onFinish={() => controls.act("done", sequence)} /> : null;
}

function HintSequenceView({ sequence, hints, onFinish }: { sequence: HintSequence; hints: readonly Hint[]; onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [layout, setLayout] = useState<{ rect: Rect; width: number; height: number } | null>(null);
  const hint = hints[step];

  const measure = useEffectEvent(() => {
    const element = hint ? document.querySelector(hint.target) : null;
    setLayout(element ? { rect: rectOf(element), width: window.innerWidth, height: window.innerHeight } : null);
  });

  const reveal = useEffectEvent(() => {
    const element = hint ? document.querySelector(hint.target) : null;
    element?.scrollIntoView({ block: "nearest" });
  });

  useEffect(() => {
    reveal();
    let frame = window.requestAnimationFrame(() => measure());
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => measure());
    };
    // Targets can appear after a scripted load, so keep looking for a moment.
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
  }, [step]);

  // Shown once its target has been measured, which also keeps it out of the server render.
  if (!hint || !layout) return null;
  const last = step === hints.length - 1;
  const { rect } = layout;
  const width = Math.min(WIDTH, layout.width - 24);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), layout.width - width - 12);
  // Below the target, or above it when there is no room below; always on screen.
  const below = Math.min(rect.top + rect.height + 12, layout.height - CARD_HEIGHT - 12);
  const position = hint.placement === "above" ? { left, bottom: Math.min(layout.height - rect.top + 12, layout.height - CARD_HEIGHT - 12) } : { left, top: Math.max(12, below) };

  return (
    <div className={styles.hint} style={{ ...position, width }} role="dialog" aria-label={`Hint ${step + 1} of ${hints.length}: ${hint.title}`} data-hint={sequence} data-demo-toolbar="">
      <p className={styles.step}>{`Hint ${step + 1} of ${hints.length}`}</p>
      <h2 className={styles.title}>{hint.title}</h2>
      <p className={styles.text}>{hint.text}</p>
      <div className={styles.actions}>
        <Button size="sm" variant="tertiary" onClick={onFinish}>
          Dismiss hints
        </Button>
        {last ? (
          <Button size="sm" variant="primary" onClick={onFinish}>
            Finish hints
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => setStep((current) => current + 1)}>
            Next hint
          </Button>
        )}
      </div>
    </div>
  );
}

export const CREATE_HINTS: readonly Hint[] = [
  { target: '[data-hint-target="prompt"]', title: "Describe what you need", text: "Type what you want to build to search the templates, or paste a repository URL from the demo's BitBucket to import it.", placement: "below" },
  { target: '[data-hint-target="import"] h2', title: "Import a repository", text: "Pick a repository in the demo's BitBucket and deploy it to a dev environment.", placement: "below" },
  { target: '[data-hint-target="solutions"] h2', title: "Start from a template", text: "Choose a portal brand to see its templates, preview them at a device's size, and deploy your own copy.", placement: "below" },
];

export const RUNTIME_HINTS: readonly Hint[] = [
  { target: '[data-tool="accessibility"]', title: "Audit accessibility", text: "Run an automated audit on this page and see each problem outlined in place.", placement: "above" },
  { target: '[data-tool="microfrontends"]', title: "Swap microfrontend versions", text: "See which microfrontend serves each part of the page, and switch any of them to another version.", placement: "above" },
  { target: '[data-tool="comments"]', title: "Comment on anything", text: "Choose any element on the page and leave a comment that stays attached to it.", placement: "above" },
];
