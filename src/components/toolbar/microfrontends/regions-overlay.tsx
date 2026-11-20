"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Placed, bottomCenter } from "@/components/toolbar/placed";
import { markToolbarEvent } from "../inspector/protocol";
import { useTargetDocument, useTargetRects } from "../target-document";
import { useToolbar } from "../toolbar-context";
import type { Member } from "./members";
import { useMicrofrontends } from "./microfrontends-state";
import styles from "./microfrontends.module.css";

const PREFIX = "single-spa-application:";

/** The single-spa application whose container holds +node+, by name. */
function regionOf(node: EventTarget | null): string | null {
  const element = node && (node as Node).nodeType === 1 ? (node as Element) : null;
  const container = element?.closest(`[id^='${PREFIX}']`);
  return container ? container.id.slice(PREFIX.length) : null;
}

/** A region's label: its name, and whether it's routed. */
function label(name: string, member: Member | undefined): string {
  return member?.route ? `${name} · Routed to ${member.route.target.label}` : `${name} · As built`;
}

/**
 * Single-spa regions on the page (restore-toolbar-tools-and-branch-previews,
 * design decision 11; template-demo/microfrontends spec, "Single-spa regions
 * can be outlined and selected"): Show regions outlines each mounted
 * application's container, labeled with its name and whether it's routed.
 * Select on page outlines the region under the pointer or focus, and
 * choosing one selects it in Microfrontends, without the application
 * receiving the click; Escape ends it, selecting nothing.
 */
export function RegionsOverlay() {
  const state = useMicrofrontends();
  const { mode, setMode, openTool } = useToolbar();
  const target = useTargetDocument();
  const { document } = target;
  const selecting = mode === "select";
  const [hovered, setHovered] = useState<string | null>(null);
  const names = state.members.filter((member) => member.region).map((member) => member.name);
  const shown = state.showRegions ? names : selecting && hovered ? [hovered] : [];
  const rects = useTargetRects(
    (frameDocument) => {
      const elements = new Map<string, Element>();
      for (const name of shown) {
        const element = frameDocument.getElementById(`${PREFIX}${name}`);
        if (element) elements.set(name, element);
      }
      return elements;
    },
    shown.length > 0,
    `${shown.join(",")}|${target.changes}`,
  );

  const choose = useEffectEvent((name: string) => {
    const member = state.members.find((candidate) => candidate.name === name);
    setMode("none");
    setHovered(null);
    if (member) state.select(member.id);
    openTool("microfrontends");
  });
  const track = useEffectEvent((node: EventTarget | null) => setHovered(regionOf(node)));

  useEffect(() => {
    if (!selecting || !document) return;
    const onMove = (event: PointerEvent) => track(event.target);
    const onFocus = (event: FocusEvent) => track(event.target);
    const onClick = (event: MouseEvent) => {
      const name = regionOf(event.target);
      if (!name) return;
      // The application never sees the click, and Timing doesn't record it.
      event.preventDefault();
      event.stopPropagation();
      markToolbarEvent(event);
      choose(name);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const name = regionOf(document.activeElement);
      if (!name) return;
      event.preventDefault();
      event.stopPropagation();
      markToolbarEvent(event);
      choose(name);
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
  }, [selecting, document]);

  // Leaving Select on page forgets the region it was over.
  if (!selecting && hovered) setHovered(null);

  if (!shown.length && !selecting) return null;
  return (
    <div className={styles.layer} data-overlay="">
      {selecting && (
        <Placed preferred={bottomCenter} className={styles.banner} role="status">
          Select a microfrontend on the page. Press Esc to cancel.
        </Placed>
      )}
      {shown.map((name) => {
        const rect = rects.get(name);
        if (!rect) return null;
        return (
          <div key={name} className={styles.outline} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} data-region-outline={name} aria-hidden="true">
            <Placed follow preferred={(size) => ({ top: rect.top - size.height, left: rect.left })} className={styles.outlineLabel}>
              {label(
                name,
                state.members.find((member) => member.name === name),
              )}
            </Placed>
          </div>
        );
      })}
    </div>
  );
}
