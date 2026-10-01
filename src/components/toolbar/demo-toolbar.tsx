"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { ShortcutsPanel } from "./shortcuts-panel";
import { ToolPanel } from "./tool-panel";
import { TOOL_BUTTONS, type ToolId, type ToolbarApi, ToolbarContext, type ToolbarMode, isTyping } from "./toolbar-context";
import { setToolbarPrefs, useToolbarPrefs } from "./toolbar-prefs";
import styles from "./toolbar.module.css";

const TOGGLE_KEY = ".";
const SHORTCUTS_KEY = "?";

/**
 * The Vercel-style toolbar over every running application (template-demo/
 * toolbar spec). It is operator interface: it follows the operator's theme,
 * never the portal's, and the portal's styles cannot reach it. Tools render
 * into one panel at a time; modes such as commenting change what the pointer does.
 */
export function DemoToolbar({ panels, overlays, commentCount = 0 }: { panels?: Partial<Record<ToolId, React.ReactNode>>; overlays?: React.ReactNode; commentCount?: number }) {
  const prefs = useToolbarPrefs();
  const [tool, setTool] = useState<ToolId | null>(null);
  const [mode, setMode] = useState<ToolbarMode>("none");
  const opener = useRef<HTMLElement | null>(null);

  const api: ToolbarApi = {
    tool,
    openTool(next, from) {
      opener.current = from ?? (document.activeElement as HTMLElement | null);
      setTool(next);
      if (prefs.collapsed) setToolbarPrefs({ collapsed: false });
    },
    closeTool() {
      setTool(null);
      const target = opener.current;
      opener.current = null;
      // Return focus once the panel is gone.
      window.requestAnimationFrame(() => target?.focus());
    },
    mode,
    setMode,
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (mode !== "none") {
        setMode("none");
        event.preventDefault();
      } else if (tool) {
        api.closeTool();
        event.preventDefault();
      }
      return;
    }
    if (!prefs.shortcuts || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    if (event.key === TOGGLE_KEY) {
      setToolbarPrefs({ collapsed: !prefs.collapsed });
      event.preventDefault();
      return;
    }
    if (event.key === SHORTCUTS_KEY) {
      api.openTool("shortcuts");
      event.preventDefault();
      return;
    }
    const match = TOOL_BUTTONS.find((button) => button.key === event.key.toLowerCase() && !event.shiftKey);
    if (!match) return;
    event.preventDefault();
    if (match.tool === "comments") {
      setTool(null);
      setMode(mode === "comment" ? "none" : "comment");
    } else api.openTool(match.tool);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const placeholder = (name: string) => (
    <ToolPanel title={name}>
      <p className={styles.muted}>This tool is not available yet.</p>
    </ToolPanel>
  );
  const panel = tool === "shortcuts" ? <ShortcutsPanel /> : tool ? (panels?.[tool] ?? placeholder(TOOL_BUTTONS.find((button) => button.tool === tool)!.name)) : null;

  return (
    <ToolbarContext value={api}>
      <div className={styles.root} data-demo-toolbar="">
        {overlays}
        {panel}
        {prefs.collapsed ? (
          <button type="button" className={styles.handle} onClick={() => setToolbarPrefs({ collapsed: false })} aria-label="Show toolbar" title="Show toolbar">
            <Icon name="chevronUp" size={14} />
            <span className={styles.demoLabel}>Demo</span>
          </button>
        ) : (
          <aside className={styles.bar} aria-label="Demo toolbar" aria-describedby="demo-toolbar-description">
            <span className={styles.demoLabel}>Demo</span>
            <span id="demo-toolbar-description" className="visually-hidden">
              This is a demonstration. Builds and deployments are simulated.
            </span>
            <span className={styles.divider} aria-hidden="true" />
            {TOOL_BUTTONS.map((button) => {
              const active = tool === button.tool || (button.tool === "comments" && mode === "comment");
              return (
                <button
                  key={button.tool}
                  type="button"
                  className={styles.toolButton}
                  aria-label={button.label}
                  title={`${button.name} (${button.key.toUpperCase()})`}
                  aria-expanded={button.tool === "comments" ? undefined : tool === button.tool}
                  aria-pressed={button.tool === "comments" ? active : undefined}
                  data-active={active || undefined}
                  data-tool={button.tool}
                  onClick={(event) => (tool === button.tool ? api.closeTool() : api.openTool(button.tool, event.currentTarget))}
                >
                  <Icon name={button.icon} size={16} />
                  {button.tool === "comments" && commentCount > 0 && (
                    <span className={styles.count}>
                      {commentCount}
                      <span className="visually-hidden">{commentCount === 1 ? " open comment" : " open comments"}</span>
                    </span>
                  )}
                </button>
              );
            })}
            <span className={styles.divider} aria-hidden="true" />
            <button type="button" className={styles.toolButton} aria-label="Show keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={(event) => api.openTool("shortcuts", event.currentTarget)}>
              <Icon name="keyboard" size={16} />
            </button>
            <button type="button" className={styles.toolButton} aria-label="Collapse toolbar" title="Collapse toolbar (.)" onClick={() => setToolbarPrefs({ collapsed: true })}>
              <Icon name="chevronDown" size={16} />
            </button>
          </aside>
        )}
      </div>
    </ToolbarContext>
  );
}
