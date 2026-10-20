"use client";

import Link from "next/link";
import { useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { type Experience, MESSAGE_STATE_LABELS, SLOT_LABELS, SLOT_TOOLKIT, ZONES, ZONE_LABELS, type ZoneId, isInstalled, messageState } from "@/lib/experience/document";
import { EditorPanes } from "./editor-panes";
import { ExternalModule, NothingSelected, OptionsSection, VisibilityToggle, usePreviewPane } from "./parts";
import { useEditor } from "./store";
import styles from "./views.module.css";

export const ZONE_DESCRIPTIONS: Record<ZoneId, string> = {
  banner: "Full-width notification strip above the header, for system-wide maintenance alerts, environment badges, and announcements.",
  header: "The bar at the top of every page: the menu toggle, the brand, and the header's controls, in order.",
  sidebar: "The left menu column: the workspace switcher at the top, the menu, and Settings and Collapse at the bottom.",
  footer: "The strip at the bottom of every page: the legal copy, the footer links, and help.",
};

const TOOLKIT_NAMES: Record<string, string> = { "global-search": "Global Search", notifications: "Notifications" };

/**
 * Frame Zones (experience-frame spec): the zone tree with slot counts,
 * visibility, and order; the live preview; and the selected zone's or slot's
 * options.
 */
export function FrameZonesView() {
  const editor = useEditor();
  const preview = usePreviewPane();
  const [collapsed, setCollapsed] = useState<Set<ZoneId>>(new Set());
  const { present } = editor;
  const base = `/navigation/${editor.portal.publicId}/editor`;

  const moveSlot = (zone: ZoneId, index: number, by: -1 | 1) =>
    editor.edit((draft) => {
      const slots = draft.frame[zone].slots;
      [slots[index], slots[index + by]] = [slots[index + by]!, slots[index]!];
    });

  return (
    <EditorPanes
      list={{
        title: "Frame Zones",
        flush: true,
        children: (
          <ul className={styles.tree} aria-label="Frame zones">
            {ZONES.map((zone) => {
              const frameZone = present.frame[zone];
              const open = !collapsed.has(zone);
              const selected = editor.selection?.kind === "zone" && editor.selection.zone === zone;
              return (
                <li key={zone} className={styles.zone} data-zone-row={zone}>
                  <div className={styles.row} data-selected={selected ? "" : undefined} onMouseEnter={() => editor.hover({ kind: "zone", zone })} onMouseLeave={() => editor.hover(null)}>
                    <button type="button" className={styles.disclosure} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${ZONE_LABELS[zone]}`} onClick={() => setCollapsed((current) => { const next = new Set(current); if (open) next.add(zone); else next.delete(zone); return next; })}>
                      <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
                    </button>
                    <button type="button" className={styles.rowLabel} aria-current={selected ? "true" : undefined} onClick={() => editor.select({ kind: "zone", zone })}>
                      <strong>{ZONE_LABELS[zone]}</strong>
                    </button>
                    <span className={styles.rowMeta}>{`${frameZone.slots.length} slot${frameZone.slots.length === 1 ? "" : "s"}`}</span>
                    <VisibilityToggle label={ZONE_LABELS[zone]} visible={frameZone.visible} onToggle={() => editor.edit((draft) => void (draft.frame[zone].visible = !draft.frame[zone].visible))} />
                  </div>
                  {open && (
                    <ul className={styles.slots} aria-label={`${ZONE_LABELS[zone]} slots`}>
                      {frameZone.slots.map((slot, index) => {
                        const toolkit = SLOT_TOOLKIT[`${zone}.${slot.id}`];
                        const unavailable = Boolean(toolkit && !isInstalled(present, toolkit));
                        const isSelected = editor.selection?.kind === "slot" && editor.selection.zone === zone && editor.selection.slot === slot.id;
                        const name = SLOT_LABELS[slot.id] ?? slot.id;
                        return (
                          <li key={slot.id} className={styles.row} data-slot-row={slot.id} data-selected={isSelected ? "" : undefined} data-unavailable={unavailable ? "" : undefined} onMouseEnter={() => editor.hover({ kind: "slot", zone, slot: slot.id })} onMouseLeave={() => editor.hover(null)}>
                            <button type="button" className={styles.rowLabel} aria-current={isSelected ? "true" : undefined} onClick={() => editor.select({ kind: "slot", zone, slot: slot.id })}>
                              {name}
                              {unavailable && <span className={styles.rowHint}>{`Needs ${TOOLKIT_NAMES[toolkit!]}`}</span>}
                            </button>
                            <button type="button" className={styles.iconButton} aria-label={`Move ${name} up`} title="Move up" disabled={index === 0} onClick={() => moveSlot(zone, index, -1)}>
                              <Icon name="arrowUp" size={14} />
                            </button>
                            <button type="button" className={styles.iconButton} aria-label={`Move ${name} down`} title="Move down" disabled={index === frameZone.slots.length - 1} onClick={() => moveSlot(zone, index, 1)}>
                              <Icon name="arrowDown" size={14} />
                            </button>
                            <VisibilityToggle label={name} visible={slot.visible && !unavailable} disabled={unavailable} onToggle={() => editor.edit((draft) => void (draft.frame[zone].slots[index]!.visible = !slot.visible))} />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        ),
      }}
      main={preview}
      options={{ title: "Options", children: <ZoneOptions base={base} /> }}
    />
  );
}

function ZoneOptions({ base }: { base: string }) {
  const editor = useEditor();
  const { selection, present } = editor;
  if (!selection || selection.kind === "overlay") return <NothingSelected>Choose a zone or slot from the Frame Zones panel on the left, or click one in the live Preview, to start editing.</NothingSelected>;

  if (selection.kind === "zone") {
    const zone = selection.zone;
    const frameZone = present.frame[zone];
    return (
      <div className={styles.options}>
        <div className={styles.optionsHeading}>
          <p className={styles.kicker}>Zone</p>
          <p className={styles.optionsTitle}>{ZONE_LABELS[zone]}</p>
          <p className={styles.optionsNote}>{ZONE_DESCRIPTIONS[zone]}</p>
        </div>
        <ExternalModule id={`zone-${zone}`} path={`frame.${zone}.external`} what="zone" value={frameZone.external} onChange={(value, coalesce) => editor.edit((draft) => void (draft.frame[zone].external = value), coalesce)} />
        <OptionsSection title="Zone options">
          <Checkbox id={`zone-${zone}-enabled`} label="Enabled" description={`Show or hide the ${ZONE_LABELS[zone].toLowerCase()} for this portal.`} checked={frameZone.visible} onChange={(event) => editor.edit((draft) => void (draft.frame[zone].visible = event.target.checked))} />
          {zone === "banner" && (
            <>
              <Select
                id="banner-status"
                label="Banner status"
                value={present.frame.banner.status}
                description="Whether the banner takes the active message's severity or forces one for the whole zone."
                options={[
                  { value: "message", label: "Use active message" },
                  { value: "info", label: "Always Info" },
                  { value: "warning", label: "Always Warning" },
                  { value: "error", label: "Always Error" },
                ]}
                onChange={(event) => editor.edit((draft) => void (draft.frame.banner.status = event.target.value as Experience["frame"]["banner"]["status"]))}
              />
              <Select
                id="banner-dismiss"
                label="Dismiss action"
                value={present.frame.banner.dismiss}
                description="Whether the active message decides if it can be dismissed, or the zone always or never allows it."
                options={[
                  { value: "message", label: "Use active message" },
                  { value: "always", label: "Always dismissible" },
                  { value: "never", label: "Never dismissible" },
                ]}
                onChange={(event) => editor.edit((draft) => void (draft.frame.banner.dismiss = event.target.value as Experience["frame"]["banner"]["dismiss"]))}
              />
            </>
          )}
        </OptionsSection>
      </div>
    );
  }

  const { zone, slot } = selection;
  const index = present.frame[zone].slots.findIndex((entry) => entry.id === slot);
  const entry = present.frame[zone].slots[index];
  if (!entry) return null;
  const toolkit = SLOT_TOOLKIT[`${zone}.${slot}`];
  const unavailable = Boolean(toolkit && !isInstalled(present, toolkit));
  const states = present.messages.map((message) => messageState(message));
  const topLevel = present.menu.filter((node) => node.parentId === null).length;
  return (
    <div className={styles.options}>
      <div className={styles.optionsHeading}>
        <p className={styles.kicker}>{`${ZONE_LABELS[zone]} → Slot`}</p>
        <p className={styles.optionsTitle}>{SLOT_LABELS[slot]}</p>
      </div>
      {unavailable ? (
        <OptionsSection title="Slot options">
          <p className={styles.optionsNote}>{`This slot needs the ${TOOLKIT_NAMES[toolkit!]} toolkit.`}</p>
          <ButtonLink href={`${base}/capabilities`} size="sm" icon="grid">
            Open Capability Toolkit
          </ButtonLink>
        </OptionsSection>
      ) : (
        <>
          <OptionsSection title="Slot options">
            <Checkbox id={`slot-${zone}-${slot}-enabled`} label="Enabled" checked={entry.visible} onChange={(event) => editor.edit((draft) => void (draft.frame[zone].slots[index]!.visible = event.target.checked))} />
            {zone === "sidebar" && slot === "main" && (
              <>
                <Select
                  id="menu-type"
                  label="Menu type"
                  value={present.frame.sidebar.menuType}
                  description="The default left menu mounts in the Sidebar Zone's Main Slot. A flyout opens from the Header Zone's Toggle Slot and hides the Sidebar Zone."
                  options={[
                    { value: "left", label: "Default left menu" },
                    { value: "flyout", label: "Flyout from the header toggle" },
                  ]}
                  onChange={(event) => editor.edit((draft) => void (draft.frame.sidebar.menuType = event.target.value as "left" | "flyout"))}
                />
                <p className={styles.optionsNote} data-menu-count="">{`${topLevel} top-level item${topLevel === 1 ? "" : "s"} configured`}</p>
                <ButtonLink href={`${base}/menu`} size="sm" icon="external">
                  Open full-page editor
                </ButtonLink>
              </>
            )}
            {(slot === "global-search" || slot === "notifications") && (
              <Link href={`${base}/capabilities`} className={styles.optionsLink}>
                {`Configure ${TOOLKIT_NAMES[slot]} in Capability Toolkit`}
              </Link>
            )}
          </OptionsSection>
          {zone === "banner" && slot === "message" && (
            <OptionsSection title={`Messages · ${present.messages.length} message${present.messages.length === 1 ? "" : "s"}`}>
              <p className={styles.counts} data-message-counts="">
                <span>{`${states.filter((state) => state === "active").length} ${MESSAGE_STATE_LABELS.active.toLowerCase()}`}</span>
                <span>{`${states.filter((state) => state === "scheduled").length} ${MESSAGE_STATE_LABELS.scheduled.toLowerCase()}`}</span>
                <span>{`${states.filter((state) => state === "disabled" || state === "expired").length} off or expired`}</span>
              </p>
              <ButtonLink href={`${base}/messages`} variant="primary" size="sm">
                Manage messages
              </ButtonLink>
              <p className={styles.optionsNote}>Ordered list of system messages. The full-window editor adds, schedules, enables, and reorders them; the banner shows the first active one.</p>
            </OptionsSection>
          )}
          <ExternalModule id={`slot-${zone}-${slot}`} path={`frame.${zone}.slots.${index}.external`} what="slot" value={entry.external} onChange={(value, coalesce) => editor.edit((draft) => void (draft.frame[zone].slots[index]!.external = value), coalesce)} />
        </>
      )}
    </div>
  );
}
