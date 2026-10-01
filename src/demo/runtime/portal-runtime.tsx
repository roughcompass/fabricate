"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { type AppRoute, loadSequence, routeByPath, shellOf, templateBySlug } from "@/lib/demo/catalog";
import { createBus } from "./bus";
import type { RuntimeDescriptor } from "./descriptor";
import { createProfilesStore, sharedProfileOf } from "./profiles";
import { MicrofrontendRegion } from "./region";
import { LoadedContext, type Runtime, RuntimeContext, useCurrentRoute, useRuntime } from "./runtime-context";
import { PortalShell } from "./shell";
import { createViewStore, effectiveVersions } from "./view-store";
import styles from "./portal-runtime.module.css";

/**
 * The running application: its portal shell and the current route's
 * microfrontends, plus anything the layout adds, such as the toolbar.
 */
export function PortalRuntime({ descriptor, children }: { descriptor: RuntimeDescriptor; children?: React.ReactNode }) {
  const [runtime] = useState<Runtime>(() => {
    const template = templateBySlug(descriptor.templateSlug)!;
    return {
      descriptor,
      template,
      app: template.app,
      store: createViewStore(template.app, descriptor.environment, descriptor.viewKey, descriptor.shareState, descriptor.shareToken),
      bus: createBus(),
      profiles: createProfilesStore(descriptor.profiles),
      sharedProfile: sharedProfileOf(descriptor.shareState),
    };
  });
  return (
    <RuntimeContext value={runtime}>
      <PortalShell>
        <CurrentRoute />
      </PortalShell>
      {children}
    </RuntimeContext>
  );
}

function CurrentRoute() {
  const route = useCurrentRoute();
  // A new route remounts its regions, so each visit replays the scripted load.
  return <RouteRegions key={route.path} route={route} />;
}

/** A route's regions, revealed one by one as their scripted loads finish. */
function RouteRegions({ route }: { route: AppRoute }) {
  const { app, store, descriptor } = useRuntime();
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());

  const begin = useEffectEvent(() => {
    const startedAt = Date.now();
    const entries = loadSequence(app, routeByPath(app, route.path) ?? route, effectiveVersions(app, descriptor.environment, store.getState().overrides));
    store.startRoute(entries, startedAt);
    const shell = shellOf(app).id;
    return entries
      .filter((entry) => entry.member !== shell)
      .map((entry) =>
        window.setTimeout(
          () =>
            setLoaded((previous) => {
              const next = new Set(previous);
              next.add(entry.member);
              return next;
            }),
          entry.startMs + entry.durationMs,
        ),
      );
  });

  useEffect(() => {
    const timers = begin();
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const single = !route.regions.some((region) => region.area === "side");
  return (
    <LoadedContext value={loaded}>
      <div className={[styles.grid, single ? styles.single : ""].join(" ")}>
        {route.regions.map((region) => (
          <MicrofrontendRegion key={region.member} member={region.member} area={region.area} />
        ))}
      </div>
    </LoadedContext>
  );
}
