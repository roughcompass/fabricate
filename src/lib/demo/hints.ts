/**
 * Guided hints (template-demo/demo-mode spec): one sequence on the create
 * page and one on running applications. Finishing or dismissing a sequence is
 * remembered for the workspace; replaying clears both; hints can be turned
 * off for the workspace. No Node or database dependencies, so the browser
 * applies the same rules the server stores.
 */

export const HINT_SEQUENCES = ["create", "runtime"] as const;
export type HintSequence = (typeof HINT_SEQUENCES)[number];
export type HintAction = "done" | "replay" | "off" | "on";

export interface HintState {
  /** Guided hints turned off for this workspace. */
  readonly off?: boolean;
  readonly create?: "done";
  readonly runtime?: "done";
}

export function isHintSequence(value: unknown): value is HintSequence {
  return HINT_SEQUENCES.includes(value as HintSequence);
}

export function isHintAction(value: unknown): value is HintAction {
  return value === "done" || value === "replay" || value === "off" || value === "on";
}

/** The state after an action; null when a "done" names no sequence. */
export function nextHints(current: HintState, action: HintAction, sequence?: HintSequence): HintState | null {
  switch (action) {
    case "done":
      return sequence ? { ...current, [sequence]: "done" } : null;
    case "replay":
      return current.off ? { off: true } : {};
    case "off":
      return { ...current, off: true };
    case "on":
      return { ...(current.create ? { create: current.create } : {}), ...(current.runtime ? { runtime: current.runtime } : {}) };
  }
}

/** Whether a sequence shows: hints are on and the sequence has not been finished or dismissed. */
export function hintsShown(state: HintState, sequence: HintSequence): boolean {
  return !state.off && state[sequence] !== "done";
}

/** Reads stored hint state, keeping only known values. */
export function parseHints(value: string): HintState {
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    return {
      ...(raw.off === true ? { off: true } : {}),
      ...(raw.create === "done" ? { create: "done" as const } : {}),
      ...(raw.runtime === "done" ? { runtime: "done" as const } : {}),
    };
  } catch {
    return {};
  }
}
