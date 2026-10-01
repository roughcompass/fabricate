"use client";

import { useEffect, useState } from "react";
import { keyLabel } from "./toolbar-context";
import styles from "./toolbar.module.css";

const HOVER_DELAY_MS = 300;
const LEAVE_GRACE_MS = 120;

interface TooltipState {
  readonly name: string;
  readonly key?: string;
  /** Offsets within the controls host: the button's vertical center, and the gap from the host's right edge. */
  readonly top: number;
  readonly right: number;
}

export interface Tooltip {
  readonly visible: boolean;
  readonly state: TooltipState | null;
  hide(): void;
}

/** The attributes that give a button the toolbar's tooltip. */
export function tooltipFor(name: string, key?: string): { "data-tooltip": string; "data-tooltip-key"?: string } {
  return key ? { "data-tooltip": name, "data-tooltip-key": key } : { "data-tooltip": name };
}

/**
 * The toolbar's one shared tooltip, for every control inside `host` marked
 * with `tooltipFor`: the control's name and its shortcut key, to the left of
 * the control. It opens after a short hover, or at once on keyboard focus,
 * stays while the pointer is over it, and closes on Escape (WCAG 1.4.13).
 */
export function useTooltip(host: React.RefObject<HTMLElement | null>): Tooltip {
  const [state, setState] = useState<TooltipState | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let timer = 0;
    let overTooltip = false;
    const targetOf = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>("[data-tooltip]") : null);
    const inTooltip = (node: EventTarget | null) => node instanceof Element && Boolean(node.closest("[data-toolbar-tooltip]"));
    const place = (target: HTMLElement) => {
      if (!target.isConnected) return;
      const container = element.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const key = target.dataset.tooltipKey;
      setState({ name: target.dataset.tooltip!, ...(key ? { key } : {}), top: box.top - container.top + box.height / 2, right: container.right - box.left + 8 });
    };
    const hideSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!overTooltip) setState(null);
      }, LEAVE_GRACE_MS);
    };
    const onOver = (event: PointerEvent) => {
      if (inTooltip(event.target)) {
        overTooltip = true;
        window.clearTimeout(timer);
        return;
      }
      const target = targetOf(event.target);
      if (!target || target.contains(event.relatedTarget as Node | null)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => place(target), HOVER_DELAY_MS);
    };
    const onOut = (event: PointerEvent) => {
      if (inTooltip(event.target) && !inTooltip(event.relatedTarget)) {
        overTooltip = false;
        hideSoon();
        return;
      }
      const target = targetOf(event.target);
      if (target && !target.contains(event.relatedTarget as Node | null)) hideSoon();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = targetOf(event.target);
      // Keyboard focus shows it at once; a click focuses the button too, and waits for the hover delay.
      if (!target?.matches(":focus-visible")) return;
      window.clearTimeout(timer);
      place(target);
    };
    const onFocusOut = () => {
      window.clearTimeout(timer);
      setState(null);
    };
    element.addEventListener("pointerover", onOver);
    element.addEventListener("pointerout", onOut);
    element.addEventListener("focusin", onFocusIn);
    element.addEventListener("focusout", onFocusOut);
    return () => {
      window.clearTimeout(timer);
      element.removeEventListener("pointerover", onOver);
      element.removeEventListener("pointerout", onOut);
      element.removeEventListener("focusin", onFocusIn);
      element.removeEventListener("focusout", onFocusOut);
    };
  }, [host]);

  return { visible: state !== null, state, hide: () => setState(null) };
}

export function ToolbarTooltip({ tooltip }: { tooltip: Tooltip }) {
  const { state } = tooltip;
  if (!state) return null;
  return (
    <div role="tooltip" className={styles.tooltip} style={{ top: state.top, right: state.right }} data-toolbar-tooltip="">
      <span>{state.name}</span>
      {state.key && <kbd className={styles.keyChip}>{keyLabel(state.key)}</kbd>}
    </div>
  );
}
