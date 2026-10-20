import { describe, expect, it } from "vitest";
import { catalogs } from "@/lib/experience/catalogs";
import { type Experience, defaultExperience } from "@/lib/experience/document";
import { diffExperience } from "@/lib/experience/fields";
import { COALESCE_MS, historyReducer, initialHistory } from "@/lib/experience/history";

/*
 * The editor's history (add-portal-experience-editor task 2.2): undo, redo,
 * a new edit clearing redo, typing coalescing into one step, and reverting a
 * pending change giving exactly the saved value.
 */

const saved = defaultExperience({ label: "Access" }, [], catalogs().toolkits, catalogs().themes, 2026);
const with_ = (base: Experience, change: (draft: Experience) => void) => {
  const next = structuredClone(base);
  change(next);
  return next;
};

describe("historyReducer", () => {
  it("undoes and redoes an edit, and a new edit clears redo", () => {
    let state = initialHistory(saved);
    const edited = with_(saved, (draft) => (draft.copyright = "© One"));
    state = historyReducer(state, { type: "edit", next: edited, at: 0 });
    expect(state.present.copyright).toBe("© One");
    state = historyReducer(state, { type: "undo" });
    expect(state.present).toEqual(saved);
    expect(state.future).toHaveLength(1);
    state = historyReducer(state, { type: "redo" });
    expect(state.present.copyright).toBe("© One");
    state = historyReducer(state, { type: "undo" });
    state = historyReducer(state, { type: "edit", next: with_(saved, (draft) => (draft.copyright = "© Two")), at: 10 });
    expect(state.future).toEqual([]);
    expect(historyReducer(state, { type: "redo" })).toBe(state);
  });

  it("merges typing in one field into one step, and starts a new step after the pause or a seal", () => {
    let state = initialHistory(saved);
    for (const [index, text] of ["©", "© J", "© JP"].entries()) state = historyReducer(state, { type: "edit", next: with_(state.present, (draft) => (draft.copyright = text)), coalesce: "copyright", at: index * 100 });
    expect(state.past).toHaveLength(1);
    state = historyReducer(state, { type: "edit", next: with_(state.present, (draft) => (draft.copyright = "© JPM")), coalesce: "copyright", at: 200 + COALESCE_MS + 1 });
    expect(state.past).toHaveLength(2);
    state = historyReducer(state, { type: "seal" });
    state = historyReducer(state, { type: "edit", next: with_(state.present, (draft) => (draft.copyright = "© JPMC")), coalesce: "copyright", at: 200 + COALESCE_MS + 2 });
    expect(state.past).toHaveLength(3);
    state = historyReducer(state, { type: "undo" });
    state = historyReducer(state, { type: "undo" });
    state = historyReducer(state, { type: "undo" });
    expect(state.present).toEqual(saved);
  });

  it("reverts one pending change to exactly its saved value, as an undoable step", () => {
    let state = initialHistory(saved);
    state = historyReducer(state, { type: "edit", next: with_(saved, (draft) => { draft.copyright = "© One"; draft.session.logoutRedirect.enabled = true; }), at: 0 });
    state = historyReducer(state, { type: "revert", key: "scalar:session.logoutRedirect.enabled", at: 1 });
    expect(state.present.session.logoutRedirect.enabled).toBe(false);
    expect(diffExperience(state.saved, state.present).map((row) => row.field)).toEqual(["Copyright information"]);
    state = historyReducer(state, { type: "undo" });
    expect(state.present.session.logoutRedirect.enabled).toBe(true);
  });

  it("ignores an edit that changes nothing, and starts over from a save", () => {
    const state = initialHistory(saved);
    expect(historyReducer(state, { type: "edit", next: structuredClone(saved), at: 0 })).toBe(state);
    const next = with_(saved, (draft) => (draft.copyright = "© Saved"));
    expect(historyReducer(state, { type: "saved", saved: next })).toEqual(initialHistory(next));
  });
});
