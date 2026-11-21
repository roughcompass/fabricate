"use client";

import { createContext, use, useEffect, useRef, useState } from "react";
import { routes } from "@/lib/web/routes";
import type { InspectorMessage } from "../inspector/protocol";
import { type LoggedCall, MOCKS_CHANNEL, isLoggedCall } from "../routing/mock-log";
import type { MockLatency } from "../routing/table";
import { readLatency, writeLatency } from "../routing/view-worker";
import { useViewWorker, useViewWorkerPart } from "../routing/view-worker-state";
import { useAgentMessages, useTargetDocument } from "../target-document";
import { useToolbarView } from "../view-context";
import { REGISTERED_WHILE_VIEWING, mockRefusalText } from "./mock-refusals";
import { type RequestRow, addRow, callRow, socketRow } from "./request-log";

/**
 * Data for a running application (add-mock-sets, design decisions 2, 14,
 * and 15): the application's mock sets, the one this view applies and where
 * it came from, the latency mocked answers wait, and the frame's API calls
 * as the view's worker answered them. The set this view applies is Data's
 * part of the view's table, which the view's worker gets before each load of
 * the frame. Choosing a set and creating a rule go through
 * /api/applications/<slug>/mock-sets.
 */

/** A rule's fields as the rules endpoint reads them (src/lib/mocks/api.ts). */
function ruleBody(draft: RuleDraft) {
  return {
    method: draft.method,
    pattern: draft.pattern,
    query: { mode: draft.queryMode, params: draft.query, ignored: draft.queryIgnored },
    body: draft.bodyMode === "ignore" || draft.body === null ? { mode: "ignore" } : { mode: draft.bodyMode, text: draft.body },
    responses: draft.response ? [{ status: draft.response.status, headers: [], contentType: draft.response.contentType, body: draft.response.body ? { text: draft.response.body } : null, latencyMs: 0 }] : [],
  };
}

/** The endpoint's errors by the form's fields: a response's are the form's own. */
function formErrors(errors: Errors | undefined, fallback: string): Errors {
  if (!errors || !Object.keys(errors).length) return { base: [fallback] };
  const mapped: Errors = {};
  for (const [field, messages] of Object.entries(errors)) {
    const name = field.replace(/^responses\.0\./, "").replace(/^query\.?/, "query").replace(/^body$/, "body");
    mapped[name] = [...(mapped[name] ?? []), ...messages];
  }
  return mapped;
}

/** One of the application's mock sets, as the choice lists it. */
export interface MockSetOption {
  readonly publicId: string;
  readonly name: string;
  readonly ruleCount: number;
  readonly revision: number;
  /** Whether it's the application's default. */
  readonly isDefault: boolean;
}

/** Where a view's active set came from (src/lib/mocks/active.ts). */
export type ActiveSource = "share" | "choice" | "preview" | "application" | "none";

/** The set a view applies, or none, and where that came from. */
export interface ActiveMocks {
  readonly set: { readonly publicId: string; readonly name: string; readonly revision: number } | null;
  readonly source: ActiveSource;
}

/** What the server knows of a view's mock sets when the page opens. */
export interface MocksStart {
  readonly sets: readonly MockSetOption[];
  readonly active: ActiveMocks;
}

/** A rule as Create rule sends it (the rules endpoint, add-mock-sets task 4.2). */
export interface RuleDraft {
  readonly method: string;
  readonly pattern: string;
  readonly queryMode: "exact" | "ignore_listed" | "ignore_all";
  readonly query: readonly (readonly [string, string])[];
  readonly queryIgnored: readonly string[];
  readonly bodyMode: "ignore" | "exact" | "json";
  readonly body: string | null;
  readonly response: { readonly status: number; readonly contentType: string | null; readonly body: string } | null;
}

export type Errors = Record<string, string[]>;

interface DataState {
  readonly sets: readonly MockSetOption[];
  readonly active: ActiveMocks;
  /** Whether the active set applies to the frame now: the worker armed with it and said it was ready. */
  readonly applies: boolean;
  /** Why the active set doesn't apply, when it should: a refusal, or what the worker said; null otherwise. */
  readonly problem: string | null;
  /** Why no set can apply in this browser for the build, known before anyone chooses; null when one can. */
  readonly refusal: string | null;
  /** Said when the build registered its own service worker during this view. */
  readonly registered: string | null;
  readonly latency: MockLatency;
  setLatency(latency: MockLatency): void;
  /** Applies +publicId+'s set, or None, to the view, keeps the choice for the visitor's workspace, and reloads the frame. Returns why it couldn't. */
  choose(publicId: string | null): Promise<string | null>;
  /** Creates an empty set named +name+ and applies it, reloading the frame. */
  createSet(name: string): Promise<{ ok: true } | { ok: false; errors: Errors }>;
  /** Adds a rule to +setPublicId+, then applies the set's new revision from the next call. */
  createRule(setPublicId: string, draft: RuleDraft): Promise<{ ok: true } | { ok: false; errors: Errors }>;
  /** The frame's calls since its document loaded, newest first. */
  readonly requests: readonly RequestRow[];
  clearRequests(): void;
  refresh(): void;
}

const DataContext = createContext<DataState | null>(null);

export function useData(): DataState {
  const state = use(DataContext);
  if (!state) throw new Error("useData must be used inside the data provider");
  return state;
}

/** The browser's local storage, or null where it can't be used. */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Pages whose calls are kept: the one shown, and those around it, whose first calls can arrive before the frame's new page is known. */
const PAGE_LIMIT = 3;

const UNREACHABLE = "The mock sets couldn't be reached. Check your connection and try again.";

export function DataProvider({ start, children }: { start: MocksStart; children: React.ReactNode }) {
  const target = useTargetDocument();
  const view = useToolbarView();
  const worker = useViewWorker();
  const [sets, setSets] = useState(start.sets);
  const [active, setActive] = useState(start.active);
  const [latency, setLatencyState] = useState<MockLatency>(() => (typeof window === "undefined" ? "off" : readLatency(storage(), view.key)));
  const [byPage, setByPage] = useState<ReadonlyMap<string, readonly RequestRow[]>>(new Map());
  const [registeredPage, setRegisteredPage] = useState<string | null>(null);
  // What the next arm applies, set before a reload or an immediate arm asks for it.
  const applying = useRef({ active: start.active, latency });

  useViewWorkerPart("mocks", () => {
    const { active: current, latency: wait } = applying.current;
    return current.set ? { application: view.slug, set: current.set.publicId, revision: current.set.revision, latency: wait } : null;
  });

  const keep = (page: string | null, row: RequestRow) => {
    if (!page) return;
    setByPage((current) => {
      const next = new Map(current);
      next.set(page, addRow(current.get(page) ?? [], row));
      while (next.size > PAGE_LIMIT) next.delete(next.keys().next().value!);
      return next;
    });
  };

  // The worker's log of the frame's calls, for this view: another tab's frame of the same view names another page.
  const { viewKey } = worker;
  useEffect(() => {
    if (!viewKey || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(MOCKS_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const entry = event.data as LoggedCall;
      if (isLoggedCall(entry) && entry.view === viewKey) keep(entry.page, callRow(entry));
    };
    return () => channel.close();
  }, [viewKey]);

  useAgentMessages((message: InspectorMessage) => {
    if (message.kind === "websocket") keep(message.page, socketRow(message.socket, Date.now()));
    else if (message.kind === "service-worker") {
      // A worker for the build's path, or above it, replaces the Frontend Registry's.
      const scope = new URL(message.registration.scope).pathname;
      if (scope.startsWith(target.base) || target.base.startsWith(scope)) setRegisteredPage(message.page);
    }
  });

  const status = worker.status;
  const armed = status?.mocks ?? null;
  const applies = Boolean(armed && !status?.refusal && status?.readiness?.ok);
  const problem = armed && !applies ? (status?.refusal ? mockRefusalText(status.refusal) : status?.readiness && !status.readiness.ok ? status.readiness.reason : null) : null;

  const send = async (method: string, address: string, body?: unknown) => {
    const response = await fetch(address, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { sets?: MockSetOption[]; active?: ActiveMocks; set?: Partial<MockSetOption> & { publicId: string }; errors?: Errors };
    return { response, data };
  };
  const viewQuery = view.preview ? { preview: view.preview } : {};

  /** Applies +next+ from the next load of the frame, and reloads it. */
  const reloadWith = (next: ActiveMocks) => {
    applying.current = { ...applying.current, active: next };
    setActive(next);
    target.reload();
  };

  const optionOf = (list: readonly MockSetOption[], publicId: string | null) => list.find((set) => set.publicId === publicId) ?? null;

  const state: DataState = {
    sets,
    active,
    applies,
    problem,
    refusal: worker.refusal ? mockRefusalText(worker.refusal) : null,
    registered: registeredPage !== null && registeredPage === target.page ? REGISTERED_WHILE_VIEWING : null,
    latency,
    setLatency(next) {
      writeLatency(storage(), view.key, next);
      setLatencyState(next);
      applying.current = { ...applying.current, latency: next };
      // From the next call, without loading the frame again.
      if (applying.current.active.set) void worker.apply();
    },
    async choose(publicId) {
      try {
        // The visitor's own choice: in a share link's view too, which then applies it instead of the link's.
        const { response, data } = await send("PUT", `${routes.mockSetChoiceApi(view.slug)}${view.preview ? `?preview=${encodeURIComponent(view.preview)}` : ""}`, { set: publicId });
        if (!response.ok) return data.errors?.base?.[0] ?? "The choice couldn't be saved. Try again.";
        const option = optionOf(sets, publicId);
        reloadWith(data.active ? { set: data.active.set, source: data.active.source } : { set: option ? { publicId: option.publicId, name: option.name, revision: option.revision } : null, source: "choice" });
        return null;
      } catch {
        return UNREACHABLE;
      }
    },
    async createSet(name) {
      try {
        const { response, data } = await send("POST", routes.mockSetsApi(view.slug), { name });
        const created = data.set;
        if (!response.ok || !created?.name) return { ok: false, errors: data.errors ?? { base: ["The mock set couldn't be created. Try again."] } };
        const option: MockSetOption = { publicId: created.publicId, name: created.name, ruleCount: created.ruleCount ?? 0, revision: created.revision ?? 1, isDefault: false };
        setSets((list) => [...list, option]);
        const reason = await state.choose(option.publicId);
        return reason ? { ok: false, errors: { base: [reason] } } : { ok: true };
      } catch {
        return { ok: false, errors: { base: [UNREACHABLE] } };
      }
    },
    async createRule(setPublicId, draft) {
      try {
        const { response, data } = await send("POST", routes.mockRulesApi(view.slug, setPublicId), ruleBody(draft));
        const updated = data.set;
        if (!response.ok || updated?.revision === undefined) return { ok: false, errors: formErrors(data.errors, "The rule couldn't be created. Try again.") };
        const revision = updated.revision;
        setSets((list) => list.map((set) => (set.publicId === updated.publicId ? { ...set, revision, ruleCount: updated.ruleCount ?? set.ruleCount } : set)));
        const current = applying.current.active;
        if (current.set?.publicId === updated.publicId) {
          // The set's new revision answers from the next call, without loading the frame again.
          const next = { ...current, set: { ...current.set, revision } };
          applying.current = { ...applying.current, active: next };
          setActive(next);
          await worker.apply();
        }
        return { ok: true };
      } catch {
        return { ok: false, errors: { base: [UNREACHABLE] } };
      }
    },
    requests: (target.page && byPage.get(target.page)) || [],
    clearRequests() {
      const page = target.page;
      if (!page) return;
      setByPage((current) => new Map(current).set(page, []));
    },
    refresh() {
      fetch(routes.mockSetsApi(view.slug, viewQuery), { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<{ sets: MockSetOption[] }>) : null))
        .then((data) => {
          if (data?.sets) setSets(data.sets);
        })
        .catch(() => {});
    },
  };
  return <DataContext value={state}>{children}</DataContext>;
}
