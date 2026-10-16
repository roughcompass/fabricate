"use client";

import { useRouter } from "next/navigation";
import { BRANDS } from "@/lib/demo/catalog";
import { blockMainThread } from "../members/planted";
import { useBusSubscription, useCurrentRoute, useProfile as useRuntimeProfile, usePublish as useRuntimePublish, useRouteHref, useRuntime } from "../runtime-context";
import { ENVIRONMENT_LABELS } from "../shell-parts";
import type { Planted, PortalApplication, PortalProfile, PortalRoute, PortalRoutes } from "./types";

export type { Planted, PortalApplication, PortalProfile, PortalRoute, PortalRoutes } from "./types";

/*
 * `@deweb/portal` in the running portal (design decision 5): each call is the
 * runtime context's own, so the toolbar records every bus message, the
 * session profile switcher drives useProfile, and routes navigate. A path
 * alias in tsconfig.json resolves the import here.
 */

/** Subscribes +member+ to +topic+ on the application's bus while it is mounted. */
export function useBus(topic: string, member: string, handler: (payload: unknown) => void): void {
  useBusSubscription(topic, member, handler);
}

/** Publishes on the application's bus as +member+. */
export function usePublish(member: string): (topic: string, payload: unknown) => void {
  return useRuntimePublish(member);
}

/** The active session profile. */
export function useProfile(): PortalProfile {
  const { name, persona, region } = useRuntimeProfile();
  return { name, persona, region };
}

/** The current route, and every route of the application, each with its address. */
export function useRoute(): PortalRoutes {
  const { app } = useRuntime();
  const current = useCurrentRoute();
  const href = useRouteHref();
  const routes = app.routes.map((route) => ({ path: route.path, label: route.label, href: href(route) }));
  return { current: routes.find((route) => route.path === current.path)!, routes };
}

/** The address of a route from useRoute. */
export function routeHref(route: PortalRoute): string {
  return route.href;
}

/** Opens a route without reloading the page, so the toolbar keeps the session's bus messages and timings. */
export function useNavigate(): (route: PortalRoute) => void {
  const router = useRouter();
  return (route) => router.push(route.href);
}

/** The running application: its name, its portal, and the environment it's deployed to. */
export function useApplication(): PortalApplication {
  const { descriptor, template } = useRuntime();
  return { name: descriptor.applicationName, portal: BRANDS[template.brand].portalName, environment: ENVIRONMENT_LABELS[descriptor.environment] ?? null };
}

export const planted: Planted = { blockMainThread };
