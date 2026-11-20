"use client";

import { createContext, use, useRef, useState } from "react";
import { usePreload, useTargetDocument } from "../target-document";
import { useToolbarView } from "../view-context";
import { type AppliedEntry, type SessionEnvironment, applySession, restoreSession, withoutQuery } from "./session-apply";

/**
 * Session presets for a running application (restore-toolbar-tools-and-
 * branch-previews, design decision 8): the application's presets, which
 * every visitor shares, the one this visitor's workspace starts it with, and
 * applying it before each load of the frame. Choosing, editing, and
 * deleting go through /api/applications/<slug>/presets.
 */

export interface Preset {
  readonly publicId: string;
  readonly name: string;
  readonly entries: readonly AppliedEntry[];
  readonly updatedByName: string | null;
  readonly lockVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PresetDraft {
  readonly name: string;
  readonly entries: readonly { readonly store: string; readonly name: string; readonly value: string }[];
}

export type Errors = Record<string, string[]>;

/** What the server knows of a view's session when the page opens: the presets, and the visitor's choice. */
export interface SessionStart {
  readonly presets: readonly Preset[];
  readonly chosen: string | null;
}

interface SessionState {
  readonly presets: readonly Preset[];
  /** The preset the visitor's workspace starts the application with, by its public ID. */
  readonly chosen: string | null;
  /** Chooses what the application starts with, and reloads the frame with it. */
  choose(publicId: string | null): Promise<string | null>;
  /** Creates a preset, or saves +editing+; returns what's wrong, and the preset as it stands when someone else changed it first. */
  save(draft: PresetDraft, editing: Preset | null): Promise<{ ok: true; preset: Preset } | { ok: false; errors: Errors; current?: Preset }>;
  /** Deletes a preset for everyone; returns why it couldn't be. */
  remove(preset: Preset): Promise<string | null>;
  refresh(): void;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const state = use(SessionContext);
  if (!state) throw new Error("useSession must be used inside the session provider");
  return state;
}

/** The browser's storage and cookies, with the cookies the build's pages see read through the frame while it shows one. */
function browserEnvironment(frame: HTMLIFrameElement | null, scope: string): SessionEnvironment {
  return {
    local: window.localStorage,
    session: window.sessionStorage,
    setCookie: (text) => {
      document.cookie = text;
    },
    readCookie(name) {
      try {
        const page = frame?.contentWindow;
        if (!page || !page.location.pathname.startsWith(scope)) return null;
        const found = page.document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
        return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
      } catch {
        return null;
      }
    },
  };
}

const UNREACHABLE: Errors = { base: ["The presets couldn't be reached. Check your connection and try again."] };

export function SessionProvider({ start, children }: { start: SessionStart; children: React.ReactNode }) {
  const target = useTargetDocument();
  const view = useToolbarView();
  const [presets, setPresets] = useState(start.presets);
  const [chosen, setChosen] = useState(start.chosen);
  // What the next load applies, set before a reload asks for it.
  const applying = useRef<Preset | null>(start.presets.find((preset) => preset.publicId === start.chosen) ?? null);
  const endpoint = (query = "") => `/api/applications/${encodeURIComponent(view.slug)}/presets${query}`;

  usePreload((address) => {
    if (typeof window === "undefined") return address;
    const environment = browserEnvironment(target.frame, target.base);
    const added = restoreSession(environment, view.key);
    const next = withoutQuery(address, added);
    const preset = applying.current;
    return preset ? applySession(environment, view.key, target.base, preset, next) : next;
  });

  const update = (data: { presets: Preset[]; chosen: string | null }) => {
    setPresets(data.presets);
    setChosen(data.chosen);
    return data;
  };

  /** Applies +publicId+'s preset, or none, from the next load on, and reloads the frame. */
  const reloadWith = (publicId: string | null, list: readonly Preset[]) => {
    applying.current = list.find((preset) => preset.publicId === publicId) ?? null;
    target.reload();
  };

  const send = async (method: string, query: string, body?: unknown) => {
    const response = await fetch(endpoint(query), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await response.json().catch(() => ({}))) as { presets?: Preset[]; chosen?: string | null; preset?: Preset | null; errors?: Errors };
    return { response, data };
  };

  const state: SessionState = {
    presets,
    chosen,
    async choose(publicId) {
      try {
        const { response, data } = await send("PUT", "", { preset: publicId });
        if (!response.ok || !data.presets) return data.errors?.base?.[0] ?? "The choice couldn't be saved. Try again.";
        update({ presets: data.presets, chosen: data.chosen ?? null });
        reloadWith(data.chosen ?? null, data.presets);
        return null;
      } catch {
        return UNREACHABLE.base![0]!;
      }
    },
    async save(draft, editing) {
      try {
        const { response, data } = editing ? await send("PATCH", `?preset=${encodeURIComponent(editing.publicId)}`, { ...draft, lockVersion: editing.lockVersion }) : await send("POST", "", draft);
        if (response.ok && data.presets && data.preset) {
          update({ presets: data.presets, chosen: data.chosen ?? null });
          // The chosen preset applies its new entries at once.
          if (editing && editing.publicId === data.chosen) reloadWith(data.chosen, data.presets);
          return { ok: true, preset: data.preset };
        }
        return { ok: false, errors: data.errors ?? { base: ["The preset couldn't be saved. Try again."] }, ...(response.status === 409 && data.preset ? { current: data.preset } : {}) };
      } catch {
        return { ok: false, errors: UNREACHABLE };
      }
    },
    async remove(preset) {
      try {
        const { response, data } = await send("DELETE", `?preset=${encodeURIComponent(preset.publicId)}`);
        if (!response.ok || !data.presets) return data.errors?.base?.[0] ?? "The preset couldn't be deleted. Try again.";
        const wasChosen = chosen === preset.publicId;
        update({ presets: data.presets, chosen: data.chosen ?? null });
        // What the deleted preset set is restored at once.
        if (wasChosen) reloadWith(null, data.presets);
        return null;
      } catch {
        return UNREACHABLE.base![0]!;
      }
    },
    refresh() {
      fetch(endpoint(), { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<{ presets: Preset[]; chosen: string | null }>) : null))
        .then((data) => {
          if (data) update(data);
        })
        .catch(() => {});
    },
  };
  return <SessionContext value={state}>{children}</SessionContext>;
}
