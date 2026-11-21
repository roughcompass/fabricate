"use client";

import { createContext, use, useCallback, useEffect, useRef, useState } from "react";
import type { InspectedComposition } from "../inspector/protocol";
import { type AppliedRoute, type AppliedRouting, readRouting, routingRefusalText, writeRouting } from "../routing/routing-client";
import type { RoutingPart } from "../routing/view-worker";
import { useViewWorker, useViewWorkerPart } from "../routing/view-worker-state";
import { useAgentMessages, useTargetDocument } from "../target-document";
import { useToolbarView } from "../view-context";
import { type Candidate, type Member, type ProfiledMicrofrontend, membersOf } from "./members";

/**
 * Microfrontends for a running application (restore-toolbar-tools-and-
 * branch-previews, design decisions 7 and 11): the members the Profile and
 * the page show, the Version choices pending until Reload application, and
 * the routing the view keeps in this browser, which the view's worker
 * applies from each load of the frame (add-mock-sets, design decision 2:
 * Microfrontends contributes the routing to the view's table, beside Data's
 * mock set). The selected member and Show regions are kept here, so Select
 * on page and the region outlines share them with the panel.
 */

interface MicrofrontendsState {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly members: readonly Member[];
  readonly selected: Member | null;
  select(id: string): void;
  /** Version choices not applied yet, by member: a candidate, or null for As built. */
  readonly pending: ReadonlyMap<string, Candidate | null>;
  /** Chooses a version for +member+; returns why it's refused, or null. */
  choose(member: Member, candidate: Candidate | null): string | null;
  /** Why routing can't run at all here, or null. */
  readonly refusal: string | null;
  readonly routes: readonly AppliedRoute[];
  /** Applies every pending choice and reloads the frame at its route. */
  reload(): void;
  /** Returns every member to As built and reloads the frame. */
  reset(): void;
  readonly showRegions: boolean;
  setShowRegions(show: boolean): void;
  /** Reads the composition and candidates again, as when the panel opens. */
  refresh(): void;
}

const MicrofrontendsContext = createContext<MicrofrontendsState | null>(null);

export function useMicrofrontends(): MicrofrontendsState {
  const state = use(MicrofrontendsContext);
  if (!state) throw new Error("useMicrofrontends must be used inside the microfrontends provider");
  return state;
}

export function MicrofrontendsProvider({ children }: { children: React.ReactNode }) {
  const target = useTargetDocument();
  const view = useToolbarView();
  const scope = target.base;
  const worker = useViewWorker();
  const [profiled, setProfiled] = useState<ProfiledMicrofrontend[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [runtime, setRuntime] = useState<{ page: string | null; composition: InspectedComposition | null }>({ page: target.page, composition: null });
  const [applied, setApplied] = useState<AppliedRouting & { kept?: readonly string[] }>(() => {
    if (typeof window === "undefined") return { scope, routes: [] };
    // A share link's routing applies to the view it opened, without replacing what this browser keeps for its own.
    if (view.shared?.routing.length) return { scope, routes: view.shared.routing.map((route) => ({ ...route, to: new URL(route.to, window.location.origin).href })) };
    return readRouting(view.key, scope);
  });
  const [pending, setPending] = useState<ReadonlyMap<string, Candidate | null>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRegions, setShowRegions] = useState(false);
  // The routing the next load arms, set before a reload asks for it.
  const latest = useRef(applied);
  if (runtime.page !== target.page) setRuntime({ page: target.page, composition: null });

  useAgentMessages((message) => {
    if (message.kind === "composition") setRuntime((current) => (current.page === message.page ? { ...current, composition: message.composition } : current));
  });

  const members = membersOf(profiled ?? [], runtime.composition, applied.routes, typeof window === "undefined" ? "" : new URL(scope, window.location.origin).href);

  // The routing the view's table holds from the next load.
  useViewWorkerPart("routing", (): RoutingPart => ({ routes: latest.current.routes.map(({ name, mechanism, from, to }) => ({ name, mechanism, from, to })), kept: latest.current.kept ?? [] }));
  // Why routing can't run: known for the build before anyone chooses, or found when routing last applied.
  const status = worker.status;
  const refusal = worker.refusal ? routingRefusalText(worker.refusal) : status?.routed && status.refusal ? routingRefusalText(status.refusal) : null;

  const { slug, preview } = view;
  const fetchComposition = useCallback(() => {
    const query = preview ? `?preview=${encodeURIComponent(preview)}` : "";
    fetch(`/api/applications/${encodeURIComponent(slug)}/composition${query}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ microfrontends: ProfiledMicrofrontend[] }>) : Promise.reject(new Error(String(response.status)))))
      .then((data) => {
        setProfiled(data.microfrontends);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [slug, preview]);

  useEffect(() => {
    // A timer callback starts the request, so the effect itself never sets state.
    const timer = window.setTimeout(fetchComposition, 0);
    return () => window.clearTimeout(timer);
  }, [fetchComposition]);

  const apply = (routing: AppliedRouting & { kept: readonly string[] }) => {
    latest.current = routing;
    writeRouting(view.key, routing);
    setApplied(routing);
    setPending(new Map());
    target.reload();
  };

  const selected = members.find((member) => member.id === selectedId) ?? members[0] ?? null;

  const state: MicrofrontendsState = {
    loading: profiled === null && !failed,
    failed,
    members,
    selected,
    select: setSelectedId,
    pending,
    choose(member, candidate) {
      if (candidate && !candidate.hasEntry) return `${candidate.application.name} · ${candidate.label} has no ${member.entryPath ?? "entry file"}, so ${member.name} can't be routed to it.`;
      // Choosing what's applied already leaves nothing pending.
      const applied = member.route?.target.build ?? null;
      setPending((previous) => {
        const next = new Map(previous);
        if ((candidate?.build?.preview ?? null) === applied) next.delete(member.id);
        else next.set(member.id, candidate);
        return next;
      });
      return null;
    },
    refusal,
    routes: applied.routes,
    reload() {
      const routes = new Map(applied.routes.map((route) => [route.id, route]));
      for (const [id, candidate] of pending) {
        const member = members.find((each) => each.id === id);
        if (!member) continue;
        if (!candidate || !candidate.build || !member.entry || !member.entryPath || member.mechanism === "found" || member.mechanism === "single-spa") {
          routes.delete(id);
          continue;
        }
        routes.set(id, {
          id,
          name: member.name,
          mechanism: member.mechanism,
          from: new URL(member.entry, window.location.origin).href,
          to: new URL(`/previews/${candidate.build.preview}/${member.entryPath}`, window.location.origin).href,
          target: { application: candidate.application.name, slug: candidate.application.slug, preview: candidate.preview?.key ?? null, label: candidate.label, commit: candidate.build.commit, build: candidate.build.preview },
        });
      }
      const kept = members.filter((member) => !routes.has(member.id) && member.entry).map((member) => new URL(member.entry!, window.location.origin).href);
      apply({ scope, routes: [...routes.values()], kept });
    },
    reset() {
      apply({ scope, routes: [], kept: [] });
    },
    showRegions,
    setShowRegions,
    refresh: fetchComposition,
  };
  return <MicrofrontendsContext value={state}>{children}</MicrofrontendsContext>;
}
