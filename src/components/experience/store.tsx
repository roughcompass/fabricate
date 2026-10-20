"use client";

import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Catalogs } from "@/lib/experience/catalogs";
import { type Experience, type ExperienceIssue, type OverlayId, type ZoneId, validateExperience } from "@/lib/experience/document";
import { type ChangeRow, diffExperience } from "@/lib/experience/fields";
import { type HistoryState, historyReducer, initialHistory } from "@/lib/experience/history";

/*
 * The experience editor's client state (add-portal-experience-editor,
 * design decision 4): the history of the working experience, the pending
 * changes it differs from the saved one by, what's selected in the frame,
 * and the save in progress. The editor's layout provides it, so it survives
 * moving between the editor's views; the history is also kept in the
 * browser tab's session storage, so a reload keeps the pending changes.
 */

export type Selection = { kind: "zone"; zone: ZoneId } | { kind: "slot"; zone: ZoneId; slot: string } | { kind: "overlay"; overlay: OverlayId };

export interface EditorPortal {
  publicId: string;
  label: string;
  lifecycle: string;
}

export interface EditorVersion {
  number: number;
  changeCount: number;
  changes: string[];
  actor: string;
  attribution: string;
  createdAt: string;
}

export interface SaveOutcome {
  kind: "saved" | "stale" | "invalid" | "nothing";
  number?: number;
  lockVersion?: number;
  experience?: Experience;
  message?: string;
  issues?: { path: string; message: string; view: string; section?: string }[];
}

export interface EditorData {
  portal: EditorPortal;
  saved: Experience;
  defaults: Experience;
  baseNumber: number;
  lockVersion: number;
  catalogs: Catalogs;
  applications: { publicId: string; name: string; slug: string | null }[];
  versions: EditorVersion[];
  demoEnabled: boolean;
  save: (portalId: string, input: { baseNumber: number; lockVersion: number; document: Experience }) => Promise<SaveOutcome>;
}

interface EditorContextValue extends Omit<EditorData, "saved" | "save"> {
  state: HistoryState;
  present: Experience;
  saved: Experience;
  pending: ChangeRow[];
  /** The working experience's problems, shown at their fields before a save. */
  issues: ExperienceIssue[];
  /** The problems at +path+, as a field's errors. */
  errorsAt: (path: string) => string[] | undefined;
  /** Applies +update+ to a copy of the working experience, as one undoable step, merging with the last when +coalesce+ matches. */
  edit: (update: (draft: Experience) => void, coalesce?: string) => void;
  seal: () => void;
  undo: () => void;
  redo: () => void;
  revert: (key: string) => void;
  save: () => Promise<SaveOutcome>;
  saving: boolean;
  outcome: SaveOutcome | null;
  clearOutcome: () => void;
  selection: Selection | null;
  select: (selection: Selection | null) => void;
  hovered: Selection | null;
  hover: (selection: Selection | null) => void;
  device: "desktop" | "phone";
  setDevice: (device: "desktop" | "phone") => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const value = use(EditorContext);
  if (!value) throw new Error("useEditor must be used inside ExperienceEditorProvider");
  return value;
}

const storageKey = (portal: string, base: number) => `fabricate-experience:${portal}:${base}`;

/** The history session storage holds for this Portal and base version, if it still reads as one. */
function storedHistory(portal: string, base: number, saved: Experience): HistoryState | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(portal, base));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Pick<HistoryState, "present" | "past" | "future">;
    if (!stored.present || !Array.isArray(stored.past) || !Array.isArray(stored.future)) return null;
    return { saved, present: stored.present, past: stored.past, future: stored.future, last: null };
  } catch {
    return null;
  }
}

export function ExperienceEditorProvider({ data, children }: { data: EditorData; children: React.ReactNode }) {
  const [state, dispatch] = useReducer(historyReducer, data.saved, (saved) => initialHistory(saved));
  const [base, setBase] = useState({ number: data.baseNumber, lockVersion: data.lockVersion });
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [selection, select] = useState<Selection | null>(null);
  const [hovered, hover] = useState<Selection | null>(null);
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const restored = useRef(false);

  // A reload in the same tab picks up the pending changes where they were.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const stored = storedHistory(data.portal.publicId, data.baseNumber, data.saved);
    if (stored) dispatch({ type: "load", state: stored });
  }, [data.portal.publicId, data.baseNumber, data.saved]);

  useEffect(() => {
    if (!restored.current) return;
    const key = storageKey(data.portal.publicId, base.number);
    try {
      if (state.past.length === 0 && state.future.length === 0 && JSON.stringify(state.present) === JSON.stringify(state.saved)) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, JSON.stringify({ present: state.present, past: state.past.slice(-50), future: state.future.slice(0, 50) }));
    } catch {
      // Storage full or unavailable: the pending changes still live in memory.
    }
  }, [state, base.number, data.portal.publicId]);

  const pending = useMemo(() => diffExperience(state.saved, state.present, data.defaults), [state.saved, state.present, data.defaults]);
  const issues = useMemo(() => validateExperience(state.present, { catalogs: data.catalogs, applications: data.applications }), [state.present, data.catalogs, data.applications]);

  const edit = useCallback(
    (update: (draft: Experience) => void, coalesce?: string) => {
      const next = structuredClone(state.present);
      update(next);
      dispatch({ type: "edit", next, coalesce, at: Date.now() });
    },
    [state.present],
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const result = await data.save(data.portal.publicId, { baseNumber: base.number, lockVersion: base.lockVersion, document: state.present });
      if (result.kind === "saved" && result.experience) {
        try {
          window.sessionStorage.removeItem(storageKey(data.portal.publicId, base.number));
        } catch {
          // Nothing stored.
        }
        setBase({ number: result.number!, lockVersion: result.lockVersion! });
        dispatch({ type: "saved", saved: result.experience });
      }
      setOutcome(result);
      return result;
    } finally {
      setSaving(false);
    }
  }, [data, base, state.present]);

  // Undo and redo from the keyboard, outside text fields.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "z" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Closing or reloading the tab with changes pending asks first; the editor's own links ask in LeaveGuard.
  useEffect(() => {
    if (pending.length === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pending.length]);

  const value: EditorContextValue = {
    portal: data.portal,
    defaults: data.defaults,
    baseNumber: base.number,
    lockVersion: base.lockVersion,
    catalogs: data.catalogs,
    applications: data.applications,
    versions: data.versions,
    demoEnabled: data.demoEnabled,
    state,
    present: state.present,
    saved: state.saved,
    pending,
    issues,
    errorsAt: (path) => {
      const found = issues.filter((issue) => issue.path === path).map((issue) => issue.message);
      return found.length ? found : undefined;
    },
    edit,
    seal: () => dispatch({ type: "seal" }),
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    revert: (key) => dispatch({ type: "revert", key, at: Date.now() }),
    save,
    saving,
    outcome,
    clearOutcome: () => setOutcome(null),
    selection,
    select,
    hovered,
    hover,
    device,
    setDevice,
  };
  return <EditorContext value={value}>{children}</EditorContext>;
}
