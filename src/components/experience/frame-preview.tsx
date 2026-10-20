"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { type Experience, type MenuNode, OVERLAY_LABELS, type OverlayId, SEVERITY_LABELS, SLOT_LABELS, ZONE_LABELS, type ZoneId, activeMessage, bannerPresentation, dialogCopyOf, slotShown } from "@/lib/experience/document";
import { type Zoom, isPhone, scaleOf } from "@/lib/experience/device";
import { resolveRange } from "@/lib/experience/semver";
import type { Selection } from "./store";
import styles from "./frame-preview.module.css";

interface FramePreviewProps {
  experience: Experience;
  /** The module registry, to label external modules with the version they resolve to. */
  modules: readonly { name: string; versions: string[] }[];
  /** The size the frame is drawn at, and the zoom: Fit, or a fixed percentage. */
  size: { width: number; height: number; zoom: Zoom };
  /** Called as the operator drags an edge or a corner, with the new size before clamping. */
  onResize?: (size: { width?: number; height?: number }) => void;
  selection?: Selection | null;
  hovered?: Selection | null;
  onSelect?: (selection: Selection) => void;
  onHover?: (selection: Selection | null) => void;
  /** Overlays shown over the frame: none, or every visible one, with +focus+ outlined. */
  overlays?: "none" | "all";
  /** Called with the scale the frame is drawn at, for the preview's label. */
  onScale?: (scale: number) => void;
  label: string;
}

const key = (selection: Selection) => (selection.kind === "zone" ? `zone:${selection.zone}` : selection.kind === "slot" ? `slot:${selection.zone}:${selection.slot}` : `overlay:${selection.overlay}`);

function parseKey(value: string): Selection | null {
  const [kind, a, b] = value.split(":");
  if (kind === "zone") return { kind, zone: a as ZoneId };
  if (kind === "slot") return { kind, zone: a as ZoneId, slot: b! };
  if (kind === "overlay") return { kind, overlay: a as OverlayId };
  return null;
}

const SEVERITY_ICONS: Record<string, IconName> = { info: "info", warning: "alert", error: "xCircle" };
const FOOTER_LINKS = ["Sitemap", "Security", "Privacy", "Contact Us", "Cobrowse", "Terms & Conditions"];

/**
 * The live preview of a portal's frame (experience-editor spec, "The preview
 * renders the working experience"): the banner, the header's slots in order,
 * the sidebar's menu, the content area, the footer, and, in Frame Overlays,
 * the overlays, drawn from the working experience at 1440 or 375 pixels and
 * scaled to fit. It's a picture of the frame for assistive technology; with
 * a pointer, hovering outlines a zone, slot, or overlay and clicking selects
 * it, as the list beside it does.
 */
export function FramePreview({ experience, modules, size, onResize, selection = null, hovered = null, onSelect, onHover, overlays = "none", onScale, label }: FramePreviewProps) {
  const outer = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const { width, height, zoom } = size;
  const scale = scaleOf({ width, zoom }, available);

  useEffect(() => {
    const measure = () => setAvailable(outer.current?.clientWidth ?? 0);
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => onScale?.(scale), [scale, onScale]);

  /** Drags an edge or the corner: the size follows the pointer at the preview's scale. */
  const drag = (edges: { width?: boolean; height?: boolean }) => (event: React.PointerEvent<HTMLElement>) => {
    if (!onResize) return;
    event.preventDefault();
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY, width, height };
    const move = (moved: PointerEvent) =>
      onResize({
        width: edges.width ? start.width + (moved.clientX - start.x) / scale : undefined,
        height: edges.height ? start.height + (moved.clientY - start.y) / scale : undefined,
      });
    // The window follows the pointer, so a fast drag that leaves the handle keeps resizing.
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const state = (target: Selection) => ({
    "data-select": key(target),
    "data-selected": selection && key(selection) === key(target) ? "" : undefined,
    "data-hovered": hovered && key(hovered) === key(target) ? "" : undefined,
  });

  const externalOf = (value: { module: string; range: string } | null) => {
    if (!value) return null;
    const registered = modules.find((module) => module.name === value.module);
    const resolved = registered ? resolveRange(registered.versions, value.range) : null;
    return `${value.module} ${resolved ?? value.range}`;
  };
  const placeholder = (text: string) => (
    <div className={styles.external}>
      <Icon name="external" size={14} />
      {text}
    </div>
  );

  const { frame } = experience;
  const message = activeMessage(experience);
  const phone = isPhone(width);

  const headerSlot = (slot: string) => {
    const target: Selection = { kind: "slot", zone: "header", slot };
    const entry = frame.header.slots.find((candidate) => candidate.id === slot)!;
    const external = externalOf(entry.external);
    let content: React.ReactNode;
    if (external) content = placeholder(external);
    else if (slot === "toggle") content = <Icon name="menu" />;
    else if (slot === "brand")
      content = (
        <span className={styles.brand}>
          {/* The logo file as a mask in the text color, so it reads in the light and the dark theme alike. */}
          <span role="img" aria-label="J.P. Morgan" className={styles.logo} />
          <span className={styles.brandDivider} aria-hidden="true" />
          <span className={styles.portalName}>{experience.brand.portalName}</span>
        </span>
      );
    else if (slot === "global-search")
      content = (
        <span className={styles.search} style={{ width: phone ? undefined : experience.toolkits.globalSearch.width }}>
          <Icon name="search" size={14} />
          {experience.toolkits.globalSearch.placeholder}
          <kbd className={styles.kbd}>{experience.toolkits.globalSearch.shortcut}</kbd>
        </span>
      );
    else if (slot === "actions") content = <Icon name="help" />;
    else if (slot === "notifications")
      content = (
        <span className={styles.bell}>
          <Icon name="bell" />
          {experience.toolkits.notifications.showUnread && <span className={styles.badge}>3</span>}
        </span>
      );
    else if (slot === "feedback") content = <Icon name="message" />;
    else content = <span className={styles.avatar}>JL</span>;
    return (
      <div key={slot} className={styles.slot} data-slot={slot} {...state(target)}>
        {content}
      </div>
    );
  };

  const headerSlots = frame.header.slots.filter((slot) => slotShown(experience, "header", slot.id)).map((slot) => slot.id);
  const brandIndex = headerSlots.indexOf("brand");
  const split = brandIndex >= 0 ? brandIndex + 1 : Math.min(1, headerSlots.length);

  const tree = (parent: string | null, depth: number): React.ReactNode => {
    const nodes = experience.menu.filter((node: MenuNode) => node.parentId === parent);
    if (nodes.length === 0) return null;
    return (
      <ul className={styles.menu} data-depth={depth}>
        {nodes.map((node) => (
          <li key={node.id}>
            <span className={styles.menuItem} data-kind={node.kind} data-default={node.isDefault ? "" : undefined}>
              {depth === 1 && <Icon name={node.kind === "group" ? "folder" : "file"} size={14} />}
              {node.label}
            </span>
            {node.kind === "group" && tree(node.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };

  const sidebarSlot = (slot: string) => {
    const target: Selection = { kind: "slot", zone: "sidebar", slot };
    const entry = frame.sidebar.slots.find((candidate) => candidate.id === slot)!;
    const external = externalOf(entry.external);
    let content: React.ReactNode;
    if (external) content = placeholder(external);
    else if (slot === "top") content = <span className={styles.switcher}>Workspace switcher</span>;
    else if (slot === "main")
      content = (
        <>
          <span className={styles.menuItem} data-current="">
            <Icon name="home" size={14} />
            Home
          </span>
          {tree(null, 1)}
        </>
      );
    else
      content = (
        <>
          <span className={styles.menuItem}>
            <Icon name="settings" size={14} />
            Settings
          </span>
          <span className={styles.menuItem}>
            <Icon name="chevronLeft" size={14} />
            Collapse
          </span>
        </>
      );
    return (
      <div key={slot} className={styles.sidebarSlot} data-slot={slot} data-main={slot === "main" ? "" : undefined} {...state(target)}>
        {content}
      </div>
    );
  };

  const footerSlot = (slot: string) => {
    const target: Selection = { kind: "slot", zone: "footer", slot };
    const entry = frame.footer.slots.find((candidate) => candidate.id === slot)!;
    const external = externalOf(entry.external);
    const content = external ? placeholder(external) : slot === "primary" ? <span>{experience.copyright}</span> : slot === "secondary" ? FOOTER_LINKS.map((link) => <span key={link} className={styles.footerLink}>{link}</span>) : <span>Help &amp; support</span>;
    return (
      <div key={slot} className={styles.footerSlot} data-slot={slot} {...state(target)}>
        {content}
      </div>
    );
  };

  const shownSlots = (zone: ZoneId) => frame[zone].slots.filter((slot) => slotShown(experience, zone, slot.id)).map((slot) => slot.id);
  const overlay = (id: OverlayId) => experience.overlays[id].visible;

  const dialog = (id: "sessionTimeout" | "duplicateSession" | "systemError") => {
    const copy = dialogCopyOf(experience, id === "sessionTimeout" ? "inactivity" : id === "duplicateSession" ? "duplicate" : "systemError");
    return (
      <div key={id} className={styles.dialog} {...state({ kind: "overlay", overlay: id })} role="presentation">
        <p className={styles.dialogTitle}>
          <Icon name={id === "systemError" ? "xCircle" : id === "duplicateSession" ? "alert" : "info"} size={14} />
          {copy.title}
        </p>
        <p className={styles.dialogMessage}>{copy.message}</p>
        <p className={styles.dialogActions}>
          {copy.secondary && <span className={styles.secondaryAction}>{copy.secondary}</span>}
          <span className={styles.primaryAction}>{copy.primary}</span>
        </p>
      </div>
    );
  };
  const toast = (id: "successToast" | "errorToast") => {
    const value = experience.overlays[id];
    return (
      <div key={id} className={styles.toast} {...state({ kind: "overlay", overlay: id })} role="presentation">
        <Icon name={id === "successToast" ? "checkCircle" : "xCircle"} size={14} />
        <span className={styles.toastText}>
          <strong>{value.title}</strong>
          <span>{value.message}</span>
          <span className={styles.toastNote}>{value.autoDismiss ? `Dismisses after ${value.seconds} seconds` : "Stays until dismissed"}</span>
        </span>
      </div>
    );
  };

  return (
    <div
      ref={outer}
      className={styles.outer}
      data-zoom={zoom}
      // At a fixed zoom the frame can be wider than the pane, which then scrolls sideways on its own.
      data-scroll-x=""
      role="img"
      aria-label={label}
      data-frame-preview=""
      data-device={phone ? "phone" : "desktop"}
      data-width={width}
      data-height={height}
      onClick={(event) => {
        const target = (event.target as HTMLElement).closest("[data-select]")?.getAttribute("data-select");
        const parsed = target ? parseKey(target) : null;
        if (parsed) onSelect?.(parsed);
      }}
      onMouseOver={(event) => {
        const target = (event.target as HTMLElement).closest("[data-select]")?.getAttribute("data-select");
        onHover?.(target ? parseKey(target) : null);
      }}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* The scaled frame's own footprint, so the pane scrolls around a frame drawn larger than it. */}
      <div className={styles.sizer} style={{ width: width * scale, height: height * scale }}>
      <div className={styles.canvas} style={{ width, height, transform: `scale(${scale})` }}>
        {frame.banner.visible && (frame.banner.external || (message && slotShown(experience, "banner", "message"))) && (
          <div className={styles.banner} data-zone="banner" data-severity={message ? bannerPresentation(experience, message).severity : undefined} {...state({ kind: "zone", zone: "banner" })}>
            {frame.banner.external ? (
              placeholder(externalOf(frame.banner.external)!)
            ) : (
              <div className={styles.slot} data-slot="message" {...state({ kind: "slot", zone: "banner", slot: "message" })}>
                {(() => {
                  const external = externalOf(frame.banner.slots[0]!.external);
                  if (external) return placeholder(external);
                  const presentation = bannerPresentation(experience, message!);
                  return (
                    <>
                      <Icon name={SEVERITY_ICONS[presentation.severity]!} size={14} label={SEVERITY_LABELS[presentation.severity]} />
                      <span className={styles.bannerText}>
                        <strong>{message!.title}</strong>
                        <span>{message!.description}</span>
                      </span>
                      {presentation.dismissible && <Icon name="x" size={14} label="Dismiss" />}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
        {frame.header.visible && (
          <div className={styles.header} data-zone="header" {...state({ kind: "zone", zone: "header" })}>
            {frame.header.external ? (
              placeholder(externalOf(frame.header.external)!)
            ) : (
              <>
                <div className={styles.headerGroup}>{headerSlots.slice(0, split).map(headerSlot)}</div>
                <div className={styles.headerGroup}>{headerSlots.slice(split).map(headerSlot)}</div>
              </>
            )}
          </div>
        )}
        <div className={styles.body}>
          {frame.sidebar.visible && frame.sidebar.menuType === "left" && !phone && (
            <div className={styles.sidebar} data-zone="sidebar" {...state({ kind: "zone", zone: "sidebar" })}>
              {frame.sidebar.external ? placeholder(externalOf(frame.sidebar.external)!) : shownSlots("sidebar").map(sidebarSlot)}
            </div>
          )}
          <div className={styles.content}>
            <p className={styles.crumbs}>Home / Workspace</p>
            <p className={styles.eyebrow}>Application content</p>
            <p className={styles.contentTitle}>Workspace overview</p>
            <p className={styles.contentNote}>The routed application owns this region.</p>
            <div className={styles.cards}>
              <span className={styles.card} />
              <span className={styles.card} />
            </div>
            <span className={styles.wideCard} />
          </div>
        </div>
        {frame.footer.visible && (
          <div className={styles.footer} data-zone="footer" {...state({ kind: "zone", zone: "footer" })}>
            {frame.footer.external ? placeholder(externalOf(frame.footer.external)!) : shownSlots("footer").map(footerSlot)}
          </div>
        )}
        {overlays === "all" && (
          <>
            <div className={styles.dialogs}>{(["sessionTimeout", "duplicateSession", "systemError"] as const).filter(overlay).map(dialog)}</div>
            <div className={styles.toasts}>{(["successToast", "errorToast"] as const).filter(overlay).map(toast)}</div>
          </>
        )}
      </div>
      {onResize && (
        <>
          <span className={styles.handleRight} data-resize-handle="right" aria-hidden="true" onPointerDown={drag({ width: true })} />
          <span className={styles.handleBottom} data-resize-handle="bottom" aria-hidden="true" onPointerDown={drag({ height: true })} />
          <span className={styles.handleCorner} data-resize-handle="corner" aria-hidden="true" onPointerDown={drag({ width: true, height: true })} />
        </>
      )}
      </div>
    </div>
  );
}

/** "Editing Banner Zone → Message Slot", for the preview's header. */
export function selectionLabel(selection: Selection | null): string | null {
  if (!selection) return null;
  if (selection.kind === "zone") return ZONE_LABELS[selection.zone];
  if (selection.kind === "slot") return `${ZONE_LABELS[selection.zone]} → ${SLOT_LABELS[selection.slot] ?? selection.slot}`;
  return OVERLAY_LABELS[selection.overlay];
}
