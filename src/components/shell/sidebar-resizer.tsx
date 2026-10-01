"use client";

import { useRef, useState } from "react";
import { SIDEBAR_WIDTH, SIDEBAR_WIDTH_COOKIE, clampSidebarWidth } from "@/lib/web/sidebar";
import { SIDEBAR_ID } from "./shell-header";
import styles from "./sidebar-resizer.module.css";

const ONE_YEAR = 60 * 60 * 24 * 365;

const shell = () => document.querySelector<HTMLElement>("[data-sidebar]");

/** Sets the sidebar's width on the shell, without a React render. */
function setWidth(width: number): void {
  shell()?.style.setProperty("--_sidebar-width", `${width}px`);
}

function remember(width: number): void {
  document.cookie = `${SIDEBAR_WIDTH_COOKIE}=${width}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

/**
 * The sidebar's resize control (operator-interface/page-patterns spec): a
 * vertical separator on the sidebar's edge. Dragging it resizes the sidebar
 * between the limits, writing the width straight to the shell while the
 * pointer moves; the arrow keys move it by a step, Home and End go to the
 * limits, and a double-click restores the default. The width is remembered in
 * a cookie, so the server renders it next time. It exists only where the
 * sidebar is inline, from 1024px.
 */
export function SidebarResizer({ initialWidth }: { initialWidth: number }) {
  const [width, setCommitted] = useState(initialWidth);
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startWidth: number; width: number; frame: number } | null>(null);

  const commit = (next: number) => {
    const clamped = clampSidebarWidth(next);
    setWidth(clamped);
    setCommitted(clamped);
    remember(clamped);
  };

  return (
    <div
      ref={handle}
      className={styles.handle}
      role="separator"
      aria-orientation="vertical"
      aria-controls={SIDEBAR_ID}
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width, width, frame: 0 };
        shell()?.setAttribute("data-resizing", "");
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        state.width = clampSidebarWidth(state.startWidth + event.clientX - state.startX);
        if (state.frame) return;
        state.frame = window.requestAnimationFrame(() => {
          state.frame = 0;
          setWidth(state.width);
          handle.current?.setAttribute("aria-valuenow", String(state.width));
          handle.current?.setAttribute("aria-valuetext", `${state.width} pixels`);
        });
      }}
      onPointerUp={(event) => {
        const state = drag.current;
        if (!state) return;
        drag.current = null;
        window.cancelAnimationFrame(state.frame);
        event.currentTarget.releasePointerCapture(event.pointerId);
        shell()?.removeAttribute("data-resizing");
        commit(state.width);
      }}
      onPointerCancel={() => {
        drag.current = null;
        shell()?.removeAttribute("data-resizing");
        setWidth(width);
      }}
      onDoubleClick={() => commit(SIDEBAR_WIDTH.default)}
      onKeyDown={(event) => {
        const next = { ArrowLeft: width - SIDEBAR_WIDTH.step, ArrowRight: width + SIDEBAR_WIDTH.step, Home: SIDEBAR_WIDTH.min, End: SIDEBAR_WIDTH.max }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        commit(next);
      }}
    />
  );
}
