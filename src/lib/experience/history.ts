import type { Experience } from "./document";
import { revertChange } from "./fields";

/*
 * The experience editor's history (add-portal-experience-editor, design
 * decision 4): the saved experience, the working one, and the steps that
 * led there, for undo and redo. An edit pushes the working experience onto
 * the undo stack and clears redo, except that edits with the same coalescing
 * key within COALESCE_MS merge into one step, so typing in a field is one
 * step. Reverting a pending change is itself an edit. Pure, so it can be
 * tested without React.
 */

export const COALESCE_MS = 800;
export const HISTORY_LIMIT = 200;

export interface HistoryState {
  saved: Experience;
  present: Experience;
  past: Experience[];
  future: Experience[];
  /** The last edit's coalescing key and time, while typing can still merge into it. */
  last: { key: string; at: number } | null;
}

export type HistoryAction =
  | { type: "edit"; next: Experience; coalesce?: string; at: number }
  | { type: "seal" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "revert"; key: string; at: number }
  | { type: "saved"; saved: Experience }
  | { type: "load"; state: HistoryState };

export function initialHistory(saved: Experience, present: Experience = saved): HistoryState {
  return { saved, present, past: [], future: [], last: null };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "edit": {
      if (JSON.stringify(action.next) === JSON.stringify(state.present)) return state;
      const merging = Boolean(action.coalesce && state.last && state.last.key === action.coalesce && action.at - state.last.at <= COALESCE_MS && state.past.length > 0);
      return {
        ...state,
        present: action.next,
        past: merging ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT),
        future: [],
        last: action.coalesce ? { key: action.coalesce, at: action.at } : null,
      };
    }
    case "seal":
      return state.last ? { ...state, last: null } : state;
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { ...state, present: previous, past: state.past.slice(0, -1), future: [state.present, ...state.future], last: null };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...state, present: next, past: [...state.past, state.present], future: rest, last: null };
    }
    case "revert":
      return historyReducer(state, { type: "edit", next: revertChange(state.saved, state.present, action.key), at: action.at });
    case "saved":
      return initialHistory(action.saved);
    case "load":
      return action.state;
  }
}
