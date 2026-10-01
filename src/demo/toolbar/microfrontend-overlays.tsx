"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { useToolbar } from "@/components/toolbar/toolbar-context";
import { useToolbarPrefs } from "@/components/toolbar/toolbar-prefs";
import { memberById, shellOf } from "@/lib/demo/catalog";
import { environmentLabel } from "@/lib/demo/routing";
import { useCurrentRoute, useRouting, useRuntime } from "../runtime/runtime-context";
import { type Rect, memberOf, regionElements, useTrackedRects } from "./geometry";
import { Placed, bottomCenter, topRight } from "./placed";
import styles from "./overlays.module.css";

const box = (rect: Rect) => ({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });

function useLabel() {
  const { app } = useRuntime();
  const routing = useRouting();
  return (member: string) => {
    const route = routing[member]!;
    return `${memberById(app, member)!.name} · ${route.version}${route.reason === "override" ? " · Overridden" : ""}`;
  };
}

/**
 * Select mode: outlines the microfrontend under the pointer or keyboard focus,
 * labeled with its name and version; choosing one opens it in the
 * Microfrontends panel. Escape leaves without changing anything.
 */
export function SelectOverlay({ onChoose }: { onChoose: (member: string) => void }) {
  const { mode, setMode, openTool } = useToolbar();
  const { app } = useRuntime();
  const label = useLabel();
  const shell = shellOf(app).id;
  const active = mode === "select";
  const [hovered, setHovered] = useState<string | null>(null);
  const rects = useTrackedRects(() => {
    if (!hovered) return new Map();
    const element = hovered === shell ? document.querySelector("[data-demo-portal]") : document.querySelector(`[data-demo-mfe="${hovered}"]`);
    return element ? new Map([[hovered, element]]) : new Map();
  }, active, hovered);

  const choose = useEffectEvent((member: string) => {
    setMode("none");
    setHovered(null);
    onChoose(member);
    openTool("microfrontends");
  });
  const track = useEffectEvent((target: EventTarget | null) => setHovered(memberOf(target as Element | null, shell)));

  useEffect(() => {
    if (!active) return;
    const onMove = (event: PointerEvent) => track(event.target);
    const onFocus = (event: FocusEvent) => track(event.target);
    const onClick = (event: MouseEvent) => {
      const member = memberOf(event.target as Element, shell);
      if (!member) return;
      event.preventDefault();
      event.stopPropagation();
      choose(member);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const member = memberOf(document.activeElement, shell);
      if (!member) return;
      event.preventDefault();
      event.stopPropagation();
      choose(member);
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [active, shell]);

  if (!active) return null;
  const rect = hovered ? rects.get(hovered) : undefined;
  return (
    <div className={styles.layer} data-overlay="">
      <Placed preferred={bottomCenter} className={styles.banner} role="status">
        Select a microfrontend on the page. Press Esc to cancel.
      </Placed>
      {hovered && rect && (
        <div className={styles.outline} style={box(rect)} data-select-outline={hovered}>
          <Placed follow preferred={(size) => ({ top: rect.top - size.height, left: rect.left })} className={styles.outlineLabel}>
            {label(hovered)}
          </Placed>
        </div>
      )}
    </div>
  );
}

/** The zone indicator: which microfrontend serves the current route, from where. It sits top right, left of an open menu or panel. */
export function ZoneIndicator() {
  const prefs = useToolbarPrefs();
  const { app } = useRuntime();
  const routing = useRouting();
  const route = useCurrentRoute();
  if (!prefs.zoneIndicator) return null;
  const owner = routing[route.owner]!;
  return (
    <Placed preferred={topRight} className={styles.zone} data-overlay="" role="status" aria-label="Zone indicator">
      <span className={styles.zoneTitle}>Zone</span>
      <span>{memberById(app, route.owner)!.name}</span>
      <code className={styles.zoneVersion}>{owner.version}</code>
      <span>{environmentLabel(owner)}</span>
      {owner.reason === "override" && <span className={styles.zoneFlag}>Overridden</span>}
    </Placed>
  );
}

/** Routing debug mode: a label on each region with its resolved version, environment, and reason. */
export function DebugLabels() {
  const prefs = useToolbarPrefs();
  const { app } = useRuntime();
  const routing = useRouting();
  const shell = shellOf(app).id;
  const rects = useTrackedRects(() => {
    const elements = new Map(regionElements());
    const header = document.querySelector('[data-demo-anchor="portal-header"]');
    if (header) elements.set(shell, header);
    return elements;
  }, prefs.debug);
  if (!prefs.debug) return null;
  return (
    <div className={styles.layer} data-overlay="">
      {[...rects].map(([member, rect]) => {
        const route = routing[member];
        if (!route) return null;
        return (
          <Placed key={member} follow preferred={() => ({ top: rect.top + 4, left: rect.left + 4 })} className={styles.debugLabel} data-debug-label={member}>
            {`${member}@${route.version} · ${environmentLabel(route)} · ${route.reason}`}
          </Placed>
        );
      })}
    </div>
  );
}
