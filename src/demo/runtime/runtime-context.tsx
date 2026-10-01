"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, use, useEffect, useEffectEvent, useMemo, useSyncExternalStore } from "react";
import { type AppDefinition, type AppRoute, type Profile, type Template, routeByPath, startRoute } from "@/lib/demo/catalog";
import { type MemberRouting, resolveRouting } from "@/lib/demo/routing";
import type { Bus } from "./bus";
import type { RuntimeDescriptor } from "./descriptor";
import { type ProfilesStore, resolveProfile } from "./profiles";
import { type Activity, type ViewState, type ViewStore, effectiveVersions } from "./view-store";

export interface Runtime {
  readonly descriptor: RuntimeDescriptor;
  readonly template: Template;
  readonly app: AppDefinition;
  readonly store: ViewStore;
  readonly bus: Bus;
  /** The visitor's own session profiles. */
  readonly profiles: ProfilesStore;
  /** A share link's profile snapshot, when the view came from one that carries it. */
  readonly sharedProfile: Profile | null;
}

export const RuntimeContext = createContext<Runtime | null>(null);

/** Which members of the current route have finished their scripted load. */
export const LoadedContext = createContext<ReadonlySet<string>>(new Set());

export function useRuntime(): Runtime {
  const runtime = use(RuntimeContext);
  if (!runtime) throw new Error("useRuntime must be used inside the portal runtime");
  return runtime;
}

export function useViewState(): ViewState {
  const { store } = useRuntime();
  return useSyncExternalStore(store.subscribe, store.getState, store.getServerState);
}

export function useActivity(): Activity {
  const { store } = useRuntime();
  return useSyncExternalStore(store.subscribe, store.getActivity, store.getActivity);
}

export function useCustomProfiles(): readonly Profile[] {
  const { profiles } = useRuntime();
  return useSyncExternalStore(profiles.subscribe, profiles.getProfiles, profiles.getProfiles);
}

/** The active session profile: who is using the application, with their persona and region. */
export function useProfile(): Profile {
  const { sharedProfile } = useRuntime();
  return resolveProfile(useViewState().profileId, useCustomProfiles(), sharedProfile);
}

export function useVersions(): Record<string, string> {
  const { app, descriptor } = useRuntime();
  const { overrides } = useViewState();
  return useMemo(() => effectiveVersions(app, descriptor.environment, overrides), [app, descriptor.environment, overrides]);
}

/** Where each member is served from, and why. */
export function useRouting(): Record<string, MemberRouting> {
  const { app, descriptor } = useRuntime();
  const { overrides } = useViewState();
  return useMemo(() => resolveRouting(app, descriptor.environment, overrides), [app, descriptor.environment, overrides]);
}

/** The application route the address names: /run/<id>/<route>, or the start route. */
export function useCurrentRoute(): AppRoute {
  const { app, descriptor } = useRuntime();
  const pathname = usePathname();
  const prefix = `/run/${descriptor.applicationId}`;
  const segment = pathname.startsWith(prefix) ? pathname.slice(prefix.length).split("/").filter(Boolean)[0] : undefined;
  return (segment && routeByPath(app, segment)) || startRoute(app);
}

export function routeHref(descriptor: RuntimeDescriptor, route: AppRoute, embedded = false): string {
  return `/run/${descriptor.applicationId}/${route.path}${embedded ? `?${EMBED_PARAM}=1` : ""}`;
}

/** Preview mode frames the application with ?embed=1, which hides the toolbar and the hints (design.md, decision 19). */
export const EMBED_PARAM = "embed";

export function useEmbedded(): boolean {
  return useSearchParams().get(EMBED_PARAM) === "1";
}

/** Links between the application's routes, which keep the application embedded while it is framed. */
export function useRouteHref(): (route: AppRoute) => string {
  const { descriptor } = useRuntime();
  const embedded = useEmbedded();
  return (route) => routeHref(descriptor, route, embedded);
}

/** Subscribes a member to a bus topic for as long as it is mounted. */
export function useBusSubscription(topic: string, member: string, handler: (payload: unknown) => void): void {
  const { bus } = useRuntime();
  const onMessage = useEffectEvent(handler);
  useEffect(() => bus.subscribe(topic, member, (payload) => onMessage(payload)), [bus, topic, member]);
}

/** Publishes on the bus as a member. */
export function usePublish(member: string): (topic: string, payload: unknown) => void {
  const { bus } = useRuntime();
  return (topic, payload) => {
    bus.publish(topic, payload, member);
  };
}
