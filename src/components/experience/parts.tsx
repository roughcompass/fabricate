"use client";

import { useState } from "react";
import { Checkbox, Select, TextInput } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { resolveRange } from "@/lib/experience/semver";
import { FramePreview, PREVIEW_WIDTHS, selectionLabel } from "./frame-preview";
import { useEditor } from "./store";
import styles from "./parts.module.css";

/*
 * Pieces the experience editor's views share: the preview pane with its
 * device toggle, the Options panel's sections, and the external module
 * control every zone and slot offers.
 */

/** The middle pane's contents for a view with a live preview of the working experience. */
export function usePreviewPane(overlays: "none" | "all" = "none", hint = "Hover or click a zone or slot to select") {
  const editor = useEditor();
  const [scale, setScale] = useState(1);
  const width = PREVIEW_WIDTHS[editor.device];
  const editing = selectionLabel(editor.selection);
  return {
    title: "Preview",
    note: editing ? `Editing ${editing}` : hint,
    aside: (
      <>
        <span data-preview-scale="">{`${width}px @ ${Math.round(scale * 100)}%`}</span>
        <button type="button" className={styles.deviceButton} aria-pressed={editor.device === "desktop"} aria-label="Desktop, 1440 pixels" title="Desktop, 1440 pixels" onClick={() => editor.setDevice("desktop")}>
          <Icon name="monitor" size={14} />
        </button>
        <button type="button" className={styles.deviceButton} aria-pressed={editor.device === "phone"} aria-label="Phone, 375 pixels" title="Phone, 375 pixels" onClick={() => editor.setDevice("phone")}>
          <Icon name="smartphone" size={14} />
        </button>
      </>
    ),
    children: (
      <FramePreview
        experience={editor.present}
        modules={editor.catalogs.modules}
        device={editor.device}
        selection={editor.selection}
        hovered={editor.hovered}
        onSelect={editor.select}
        onHover={editor.hover}
        overlays={overlays}
        onScale={setScale}
        label={`Preview of ${editor.portal.label}'s portal frame`}
      />
    ),
  };
}

/** A titled group in the Options panel. */
export function OptionsSection({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {aside}
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

/** Nothing selected: how to select something. */
export function NothingSelected({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.nothing}>
      <p className={styles.nothingTitle}>Nothing selected</p>
      <p>{children}</p>
    </div>
  );
}

/**
 * Replace with external module (experience-frame spec): a registered module
 * and a semver range, with the version the registry resolves it to.
 */
export function ExternalModule({ id, path, value, onChange, what }: { id: string; path: string; value: { module: string; range: string } | null; onChange: (value: { module: string; range: string } | null, coalesce?: string) => void; what: string }) {
  const editor = useEditor();
  const modules = editor.catalogs.modules;
  const registered = value ? modules.find((module) => module.name === value.module) : undefined;
  const resolved = value && registered ? resolveRange(registered.versions, value.range) : null;
  return (
    <OptionsSection title="External module">
      <p className={styles.note}>{`Replace this ${what}'s native content with a CDaaS-deployed module. Pick a registered module (@organization/name) and enter a semver range; the registry resolves it to the highest matching version.`}</p>
      <Checkbox id={`${id}-external`} label="Replace with external module" checked={value !== null} onChange={(event) => onChange(event.target.checked ? { module: modules[0]?.name ?? "", range: "^1.0.0" } : null)} />
      {value && (
        <>
          <Select id={`${id}-module`} label="Module" value={value.module} errors={editor.errorsAt(`${path}.module`)} options={modules.map((module) => ({ value: module.name, label: module.name }))} onChange={(event) => onChange({ ...value, module: event.target.value })} />
          <TextInput id={`${id}-range`} label="Version range" mono value={value.range} errors={editor.errorsAt(`${path}.range`)} description={resolved ? `Resolves to ${resolved}` : undefined} onChange={(event) => onChange({ ...value, range: event.target.value }, `${path}.range`)} onBlur={editor.seal} />
        </>
      )}
    </OptionsSection>
  );
}

/** A visibility control for a zone, slot, or overlay, named for it and announcing whether it's shown. */
export function VisibilityToggle({ label, visible, disabled, onToggle }: { label: string; visible: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={styles.iconButton} aria-pressed={visible} aria-label={`Show ${label}`} title={visible ? `Hide ${label}` : `Show ${label}`} disabled={disabled} onClick={onToggle} data-visible={visible ? "" : undefined}>
      <Icon name={visible ? "eye" : "eyeOff"} size={14} />
    </button>
  );
}
