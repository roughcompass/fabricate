"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { boundRef, remeasureToolbarBounds } from "./toolbar-bounds";
import { markToolbarEvent } from "./inspector/protocol";
import { ShortcutsPanel } from "./shortcuts-panel";
import { useOptionalTargetDocument } from "./target-document";
import { ToolPanel } from "./tool-panel";
import { type MenuContext, ToolbarMenu } from "./toolbar-menu";
import { type ToolId, type ToolbarApi, ToolbarContext, type ToolbarItem, type ToolbarMode, activeItemFor, isTyping, itemForKey, keyLabel } from "./toolbar-context";

/** A tool the pill shows at rest, marked, because it applies something to the view now, such as Data's mock set; +name+ names it and what it applies. */
export interface RestingItem {
  readonly item: ToolbarItem;
  readonly name: string;
}
import { setToolbarPrefs, useToolbarPrefs } from "./toolbar-prefs";
import { ToolbarTooltip, tooltipFor, useTooltip } from "./toolbar-tooltip";
import styles from "./toolbar.module.css";

/**
 * The Vercel-style toolbar over every running application (template-demo/
 * toolbar spec): a pill docked to the middle of the right edge, a menu that
 * finds every tool, and one tool panel at a time, all opening to the left of
 * the pill. It is operator interface: it follows the operator's theme, never
 * the application's.
 *
 * Its controls live in the browser's top layer (a manual popover), so nothing
 * on the page and none of the toolbar's own overlays can paint over them
 * (design.md, decision 1). The overlays it draws over the page sit in a
 * separate layer below.
 */
export function Toolbar({ panels, overlays, commentCount = 0, context, resting = null }: { panels?: Partial<Record<ToolId, React.ReactNode>>; overlays?: React.ReactNode; commentCount?: number; context: MenuContext; resting?: RestingItem | null }) {
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

  useToolbarKeys(handleKey);
  useTopLayer(host);

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
      <div className={styles.overlays} data-toolbar="overlays">
        {overlays}
      </div>
      <div ref={host} popover="manual" className={styles.host} data-toolbar="controls" data-collapsed={prefs.collapsed || undefined}>
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
          <ToolbarPill
            active={active}
            resting={resting}
            onResting={(item, from) => runItem(item, from)}
            menuButton={menuButton}
            menuOpen={menu !== null}
            commentCount={commentCount}
            onActive={() => (mode !== "none" ? setMode("none") : closeTool())}
            onMenu={() => (menu ? setMenu(null) : api.openMenu())}
          />
        )}
        <ToolbarTooltip tooltip={tooltip} />
      </div>
    </ToolbarContext>
  );
}

/**
 * The expanded pill: a tool that applies something to the view, at rest
 * and marked, which opens it; the active tool or mode, which turns it off;
 * and the menu button with the open comment count.
 */
function ToolbarPill({ active, resting, onResting, menuButton, menuOpen, commentCount, onActive, onMenu }: { active: ToolbarItem | null; resting: RestingItem | null; onResting: (item: ToolbarItem, from: HTMLElement) => void; menuButton: React.Ref<HTMLButtonElement>; menuOpen: boolean; commentCount: number; onActive: () => void; onMenu: () => void }) {
  const marked = resting && active?.id === resting.item.id ? resting : null;
  return (
    <aside ref={boundRef("pill")} className={styles.pill} aria-label="Toolbar">
      {resting && !marked && (
        <button
          type="button"
          className={styles.pillButton}
          aria-label={resting.name}
          aria-keyshortcuts={resting.item.key ? keyLabel(resting.item.key) : undefined}
          data-resting=""
          data-toolbar-item={resting.item.id}
          onClick={(event) => onResting(resting.item, event.currentTarget)}
          {...tooltipFor(resting.name, resting.item.key)}
        >
          <Icon name={resting.item.icon} size={16} />
          <span className={styles.marker} aria-hidden="true" />
        </button>
      )}
      {active && (
        <button
          type="button"
          className={styles.pillButton}
          aria-label={marked ? marked.name : active.name}
          aria-pressed="true"
          aria-keyshortcuts={active.key ? keyLabel(active.key) : undefined}
          data-active=""
          data-resting={marked ? "" : undefined}
          data-toolbar-item={active.id}
          onClick={onActive}
          {...tooltipFor(marked ? marked.name : active.name, active.key)}
        >
          <Icon name={active.icon} size={16} />
          {marked && <span className={styles.marker} aria-hidden="true" />}
        </button>
      )}
      <button
        ref={menuButton}
        type="button"
        className={styles.pillButton}
        aria-label={commentCount > 0 ? `Open toolbar menu, ${commentCount} open ${commentCount === 1 ? "comment" : "comments"}` : "Open toolbar menu"}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        data-menu-button=""
        onClick={onMenu}
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
  );
}

/**
 * Runs +handleKey+ for every key press on the page and, over a framed
 * application, in its page too, so shortcuts work while focus is there. Key
 * presses the toolbar acted on, such as its shortcuts, are left out of the
 * application's interactions.
 */
function useToolbarKeys(handleKey: (event: KeyboardEvent) => void) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const prevented = event.defaultPrevented;
    handleKey(event);
    if (!prevented && event.defaultPrevented) markToolbarEvent(event);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const framed = useOptionalTargetDocument()?.document ?? null;
  useEffect(() => {
    if (!framed) return;
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    framed.addEventListener("keydown", listener);
    return () => framed.removeEventListener("keydown", listener);
  }, [framed]);
}

/** Puts +host+ in the top layer on mount, and back on top whenever another top-layer element opens. */
function useTopLayer(host: React.RefObject<HTMLElement | null>) {
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
  }, [host]);
}
