"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { boundRef, remeasureToolbarBounds } from "@/demo/toolbar/toolbar-bounds";
import { markToolbarEvent } from "./inspector/protocol";
import { ShortcutsPanel } from "./shortcuts-panel";
import { useOptionalTargetDocument } from "./target-document";
import { ToolPanel } from "./tool-panel";
import { type MenuContext, ToolbarMenu } from "./toolbar-menu";
import { type ToolId, type ToolbarApi, ToolbarContext, type ToolbarItem, type ToolbarMode, activeItemFor, isTyping, itemForKey, keyLabel } from "./toolbar-context";
import { setToolbarPrefs, useToolbarPrefs } from "./toolbar-prefs";
import { ToolbarTooltip, tooltipFor, useTooltip } from "./toolbar-tooltip";
import styles from "./toolbar.module.css";

/**
 * The Vercel-style toolbar over every running application (template-demo/
 * toolbar spec): a pill docked to the middle of the right edge, a menu that
 * finds every tool, and one tool panel at a time, all opening to the left of
 * the pill. It is operator interface: it follows the operator's theme, never
 * the portal's.
 *
 * Its controls live in the browser's top layer (a manual popover), so nothing
 * on the page and none of the toolbar's own overlays can paint over them
 * (design.md, decision 1). The overlays it draws over the page sit in a
 * separate layer below.
 */
export function DemoToolbar({ panels, overlays, commentCount = 0, context }: { panels?: Partial<Record<ToolId, React.ReactNode>>; overlays?: React.ReactNode; commentCount?: number; context: MenuContext }) {
  const prefs = useToolbarPrefs();
  const [tool, setTool] = useState<ToolId | null>(null);
  const [mode, setMode] = useState<ToolbarMode>("none");
  const [menu, setMenu] = useState<{ highlight: string | null } | null>(null);
  const [menuRoom, setMenuRoom] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const tooltip = useTooltip(host);

  const openTool = (next: ToolId, from?: HTMLElement | null) => {
    opener.current = from ?? (document.activeElement as HTMLElement | null);
    setMenu(null);
    setTool(next);
    if (prefs.collapsed) setToolbarPrefs({ collapsed: false });
  };
  const closeTool = () => {
    setTool(null);
    const target = opener.current?.isConnected ? opener.current : menuButton.current;
    opener.current = null;
    // Return focus once the panel is gone.
    window.requestAnimationFrame(() => target?.focus());
  };
  const runItem = (item: ToolbarItem, from?: HTMLElement | null) => {
    setMenu(null);
    tooltip.hide();
    const action = item.action;
    if (action.kind === "tool") openTool(action.tool, from ?? menuButton.current);
    else if (action.kind === "mode") {
      setTool(null);
      setMode((current) => (current === action.mode ? "none" : action.mode));
    } else setToolbarPrefs({ collapsed: true });
  };

  const api: ToolbarApi = {
    tool,
    openTool,
    closeTool,
    mode,
    setMode,
    menuOpen: menu !== null,
    openMenu(highlight) {
      setTool(null);
      if (prefs.collapsed) setToolbarPrefs({ collapsed: false });
      setMenu({ highlight: highlight ?? null });
    },
    closeMenu() {
      setMenu(null);
    },
    activeItem: activeItemFor(tool, mode),
    runItem,
    setMenuRoom,
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (tooltip.visible) {
        tooltip.hide();
        event.preventDefault();
      } else if (menu) {
        setMenu(null);
        menuButton.current?.focus();
        event.preventDefault();
      } else if (mode !== "none") {
        setMode("none");
        event.preventDefault();
      } else if (tool) {
        closeTool();
        event.preventDefault();
      }
      return;
    }
    if (!prefs.shortcuts || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    const item = itemForKey(event.key);
    // Letters are plain presses; "?" needs Shift on most keyboards.
    if (!item || (event.shiftKey && /^[a-z]$/i.test(event.key))) return;
    event.preventDefault();
    if (item.action.kind === "command") setToolbarPrefs({ collapsed: !prefs.collapsed });
    // A shortcut has no opening control; focus goes back to wherever it was.
    else runItem(item, document.activeElement as HTMLElement | null);
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const prevented = event.defaultPrevented;
    handleKey(event);
    // Key presses the toolbar acted on, such as its shortcuts, are left out of the application's interactions.
    if (!prevented && event.defaultPrevented) markToolbarEvent(event);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  // Over a framed application, shortcuts also work while focus is in its page.
  const framed = useOptionalTargetDocument()?.document ?? null;
  useEffect(() => {
    if (!framed) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    framed.addEventListener("keydown", listener);
    return () => framed.removeEventListener("keydown", listener);
  }, [framed]);

  // The controls enter the top layer on mount, and go back on top whenever another top-layer element opens.
  useEffect(() => {
    const element = host.current;
    if (!element || typeof element.showPopover !== "function") return;
    if (!element.matches(":popover-open")) element.showPopover();
    const onToggle = (event: Event) => {
      const target = event.target as Element | null;
      if (target === element || (event as ToggleEvent).newState !== "open") return;
      element.hidePopover();
      element.showPopover();
    };
    document.addEventListener("toggle", onToggle, true);
    return () => document.removeEventListener("toggle", onToggle, true);
  }, []);

  useEffect(() => {
    remeasureToolbarBounds();
  }, [tool, mode, menu, menuRoom, prefs.collapsed]);

  const placeholder = (name: string) => (
    <ToolPanel title={name}>
      <p className={styles.muted}>This tool is not available yet.</p>
    </ToolPanel>
  );
  const panel = tool === "shortcuts" ? <ShortcutsPanel /> : tool ? (panels?.[tool] ?? placeholder(activeItemFor(tool, "none")?.name ?? tool)) : null;
  const active = activeItemFor(tool, mode);

  return (
    <ToolbarContext value={api}>
      <div className={styles.overlays} data-demo-toolbar="overlays">
        {overlays}
      </div>
      <div ref={host} popover="manual" className={styles.host} data-demo-toolbar="controls" data-collapsed={prefs.collapsed || undefined}>
        {panel && (
          <div ref={boundRef("panel")} className={styles.side}>
            {panel}
          </div>
        )}
        {menu && (
          <div ref={boundRef("menu")} className={styles.side} data-room={menuRoom > 0 || undefined} style={menuRoom > 0 ? ({ "--_room": `${menuRoom}px` } as React.CSSProperties) : undefined}>
            <ToolbarMenu context={context} commentCount={commentCount} highlight={menu.highlight} onClose={() => menuButton.current?.focus()} />
          </div>
        )}
        {prefs.collapsed ? (
          <button ref={boundRef("pill")} type="button" className={styles.tab} onClick={() => setToolbarPrefs({ collapsed: false })} aria-label="Show toolbar" title="Show toolbar">
            <Icon name="chevronLeft" size={14} />
          </button>
        ) : (
          <aside ref={boundRef("pill")} className={styles.pill} aria-label="Toolbar" aria-describedby="demo-toolbar-description">
            <span id="demo-toolbar-description" className="visually-hidden">
              Builds and deployments are simulated.
            </span>
            {active && (
              <button
                type="button"
                className={styles.pillButton}
                aria-label={active.name}
                aria-pressed="true"
                aria-keyshortcuts={active.key ? keyLabel(active.key) : undefined}
                data-active=""
                data-toolbar-item={active.id}
                onClick={() => (mode !== "none" ? setMode("none") : closeTool())}
                {...tooltipFor(active.name, active.key)}
              >
                <Icon name={active.icon} size={16} />
              </button>
            )}
            <button
              ref={menuButton}
              type="button"
              className={styles.pillButton}
              aria-label={commentCount > 0 ? `Open toolbar menu, ${commentCount} open ${commentCount === 1 ? "comment" : "comments"}` : "Open toolbar menu"}
              aria-haspopup="dialog"
              aria-expanded={menu !== null}
              data-menu-button=""
              onClick={() => (menu ? setMenu(null) : api.openMenu())}
              {...tooltipFor("Menu")}
            >
              <Icon name="toolbar" size={16} />
              {commentCount > 0 && (
                <span className={styles.count} aria-hidden="true">
                  {commentCount}
                </span>
              )}
            </button>
          </aside>
        )}
        <ToolbarTooltip tooltip={tooltip} />
      </div>
    </ToolbarContext>
  );
}
