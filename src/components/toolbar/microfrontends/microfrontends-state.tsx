"use client";

import { createContext, use, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { routes as addresses } from "@/lib/web/routes";
import type { InspectedComposition } from "../inspector/protocol";
import { type AppliedRoute, type AppliedRouting, armRouting, disarmRouting, readRouting, rearmRouting, routingRefusal, writeRouting } from "../routing/routing-client";
import type { RoutingTable } from "../routing/table";
import { useAgentMessages, usePreload, useTargetDocument } from "../target-document";
import { useToolbarView } from "../view-context";
import { type Candidate, type Member, type ProfiledMicrofrontend, membersOf } from "./members";

/**
 * Microfrontends for a running application (restore-toolbar-tools-and-
 * branch-previews, design decisions 7 and 11): the members the Profile and
 * the page show, the Version choices pending until Reload application, and
 * the routing the view keeps in this browser, which arms the routing worker
 * before each load of the frame and every few seconds while the page is
 * open. The selected member and Show regions are kept here, so Select on
 * page and the region outlines share them with the panel.
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

/** How often the page arms the routing worker again while it's open; the worker drops a table not armed for 90 seconds. */
const REARM_MS = 5000;

/** The frame's address, while it shows a page. */
function frameAddress(frame: HTMLIFrameElement | null): string | null {
  try {
    const href = frame?.contentWindow?.location.href ?? null;
    return href && href !== "about:blank" ? href : null;
  } catch {
    return null;
  }
}

export function MicrofrontendsProvider({ children }: { children: React.ReactNode }) {
  const target = useTargetDocument();
  const view = useToolbarView();
  const scope = target.base;
  const viewAddress = addresses.runningApplication(view.slug, "", undefined, view.preview);
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
  const [refusal, setRefusal] = useState<string | null>(null);
  const [showRegions, setShowRegions] = useState(false);
  // The routing the next load arms, set before a reload asks for it.
  const latest = useRef(applied);
  if (runtime.page !== target.page) setRuntime({ page: target.page, composition: null });

  useAgentMessages((message) => {
    if (message.kind === "composition") setRuntime((current) => (current.page === message.page ? { ...current, composition: message.composition } : current));
  });

  const members = membersOf(profiled ?? [], runtime.composition, applied.routes, typeof window === "undefined" ? "" : new URL(scope, window.location.origin).href);

  const tableOf = (routing: AppliedRouting & { kept?: readonly string[] }): RoutingTable => ({ view: viewAddress, scope, routes: routing.routes.map(({ name, mechanism, from, to }) => ({ name, mechanism, from, to })), kept: routing.kept ?? [] });

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

  // Whether this browser and the build's path allow routing at all, said before anyone chooses.
  useEffect(() => {
    let live = true;
    void routingRefusal(scope).then((reason) => {
      if (live) setRefusal(reason);
    });
    return () => {
      live = false;
    };
  }, [scope]);

  usePreload(async (address) => {
    const routing = latest.current;
    if (!routing.routes.length) {
      await disarmRouting(viewAddress, scope).catch(() => {});
      return address;
    }
    const reason = await routingRefusal(scope);
    if (reason) {
      setRefusal(reason);
      return address;
    }
    try {
      await armRouting(tableOf(routing), frameAddress(target.frame));
    } catch {
      setRefusal("The routing service worker couldn't start in this browser, so routing isn't applied.");
    }
    return address;
  });

  const rearm = useEffectEvent(() => void rearmRouting(tableOf(latest.current), frameAddress(target.frame)).catch(() => {}));
  useEffect(() => {
    if (!applied.routes.length) return;
    const timer = window.setInterval(() => rearm(), REARM_MS);
    return () => window.clearInterval(timer);
  }, [applied]);

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
