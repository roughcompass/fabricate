"use client";

import { useEffect, useId, useRef } from "react";
import { Icon } from "@/components/ui/icon";
import { activeItemFor, useToolbar } from "./toolbar-context";
import styles from "./toolbar.module.css";

/**
 * A toolbar tool's panel: a labeled, non-modal dialog to the left of the
 * pill. Opening moves focus into it; closing, by its Close button or Escape,
 * returns focus to what opened it. Back to menu reopens the menu with this
 * tool highlighted.
 */
export function ToolPanel({ title, description, actions, children, wide = false }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  const { closeTool, openMenu, tool } = useToolbar();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = panel.current;
    const focusable = element?.querySelector<HTMLElement>("[data-autofocus], input, select, textarea, button:not([data-panel-close]):not([data-panel-back]), a[href]");
    (focusable ?? element)?.focus();
  }, []);

  return (
    <div ref={panel} role="dialog" aria-labelledby={titleId} className={[styles.panel, wide && styles.panelWide].filter(Boolean).join(" ")} tabIndex={-1} data-tool-panel="">
      <div className={styles.panelHeader}>
        <button type="button" className={styles.iconButton} onClick={() => openMenu(activeItemFor(tool, "none")?.id)} aria-label="Back to menu" title="Back to menu" data-panel-back="">
          <Icon name="arrowLeft" size={14} />
        </button>
        <div className={styles.panelHeading}>
          <h2 id={titleId} className={styles.panelTitle}>
            {title}
          </h2>
          {description && <p className={styles.panelDescription}>{description}</p>}
        </div>
        {actions}
        <button type="button" className={styles.iconButton} onClick={closeTool} aria-label={`Close ${title.toLowerCase()}`} title="Close" data-panel-close="">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className={styles.panelBody}>{children}</div>
    </div>
  );
}
