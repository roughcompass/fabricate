import { useEffect, useEffectEvent } from "react";
import { createBus } from "@/demo/runtime/bus";
import { blockMainThread } from "@/demo/runtime/members/planted";
import type { Planted, PortalApplication, PortalProfile, PortalRoute, PortalRoutes } from "@/demo/runtime/portal/types";
import { RENDER_CONFIG_ID, type RenderConfig } from "./protocol";

export type { Planted, PortalApplication, PortalProfile, PortalRoute, PortalRoutes } from "@/demo/runtime/portal/types";

/*
 * `@deweb/portal` inside the prototype frame (converge-templates-and-
 * prototypes, design decision 5). Prototypes don't run inside the portal, so
 * there's nothing to reach: the bus connects the page's own regions, the
 * session profile is the version's first persona, and routes don't navigate.
 * The import map resolves `@deweb/portal` here, once per frame, so every
 * region shares one bus.
 */

const config = JSON.parse(globalThis.document?.getElementById(RENDER_CONFIG_ID)?.textContent ?? "null") as RenderConfig | null;
const bus = createBus();

/** Subscribes +member+ to +topic+ on the page's own bus while it is mounted. */
export function useBus(topic: string, member: string, handler: (payload: unknown) => void): void {
  const onMessage = useEffectEvent(handler);
  useEffect(() => bus.subscribe(topic, member, (payload) => onMessage(payload)), [topic, member]);
}

/** Publishes on the page's own bus as +member+. */
export function usePublish(member: string): (topic: string, payload: unknown) => void {
  return (topic, payload) => {
    bus.publish(topic, payload, member);
  };
}

/** The version's first persona, as the session profile. */
export function useProfile(): PortalProfile {
  return { name: config?.user.name ?? "Visitor", persona: config?.user.role ?? "Visitor", region: "" };
}

const CURRENT: PortalRoute = { path: "", label: config?.title ?? "", href: "#" };

/** The page itself, as the only route; its address goes nowhere. */
export function useRoute(): PortalRoutes {
  return { current: CURRENT, routes: [CURRENT] };
}

/** The address of a route from useRoute. */
export function routeHref(route: PortalRoute): string {
  return route.href;
}

/** Routes don't navigate inside the frame. */
export function useNavigate(): (route: PortalRoute) => void {
  return () => undefined;
}

/** The page, as the application: the frame has no portal or deployment. */
export function useApplication(): PortalApplication {
  return { name: config?.title ?? "", portal: "", environment: null };
}

export const planted: Planted = { blockMainThread };
