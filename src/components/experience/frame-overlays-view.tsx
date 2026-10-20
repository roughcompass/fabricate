"use client";

import { Switch, TextArea, TextInput } from "@/components/ui/form";
import { LIMITS, OVERLAY_LABELS, type OverlayId, type SessionDialog } from "@/lib/experience/document";
import { EditorPanes } from "./editor-panes";
import { NothingSelected, OptionsSection, VisibilityToggle, usePreviewPane } from "./parts";
import { useEditor } from "./store";
import styles from "./views.module.css";

const GROUPS: { name: string; overlays: OverlayId[] }[] = [
  { name: "Session Overlay", overlays: ["sessionTimeout", "duplicateSession", "systemError"] },
  { name: "Toast Overlay", overlays: ["successToast", "errorToast"] },
];

const DIALOG_OF: Partial<Record<OverlayId, SessionDialog>> = { sessionTimeout: "inactivity", duplicateSession: "duplicate", systemError: "systemError" };

/**
 * Frame Overlays (experience-frame spec, "Frame overlays are configured and
 * previewed"): the Session Overlay's dialogs and the Toast Overlay's toasts,
 * each shown or hidden, previewed over the frame, and edited in Options.
 */
export function FrameOverlaysView() {
  const editor = useEditor();
  const preview = usePreviewPane("all", "Hover or click an overlay to select");
  const { overlays } = editor.present;
  return (
    <EditorPanes
      list={{
        title: "Frame Overlays",
        flush: true,
        children: (
          <ul className={styles.tree} aria-label="Frame overlays">
            {GROUPS.map((group) => {
              const allVisible = group.overlays.every((overlay) => overlays[overlay].visible);
              return (
                <li key={group.name} className={styles.zone}>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>
                      <strong>{group.name}</strong>
                    </span>
                    <span className={styles.rowMeta}>{`${group.overlays.length} slots`}</span>
                    <VisibilityToggle label={group.name} visible={allVisible} onToggle={() => editor.edit((draft) => group.overlays.forEach((overlay) => void (draft.overlays[overlay].visible = !allVisible)))} />
                  </div>
                  <ul className={styles.slots} aria-label={`${group.name} slots`}>
                    {group.overlays.map((overlay) => {
                      const selected = editor.selection?.kind === "overlay" && editor.selection.overlay === overlay;
                      return (
                        <li key={overlay} className={styles.row} data-overlay-row={overlay} data-selected={selected ? "" : undefined} onMouseEnter={() => editor.hover({ kind: "overlay", overlay })} onMouseLeave={() => editor.hover(null)}>
                          <button type="button" className={styles.rowLabel} aria-current={selected ? "true" : undefined} onClick={() => editor.select({ kind: "overlay", overlay })}>
                            {OVERLAY_LABELS[overlay]}
                          </button>
                          <VisibilityToggle label={OVERLAY_LABELS[overlay]} visible={overlays[overlay].visible} onToggle={() => editor.edit((draft) => void (draft.overlays[overlay].visible = !draft.overlays[overlay].visible))} />
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        ),
      }}
      main={preview}
      options={{ title: "Options", children: <OverlayOptions /> }}
    />
  );
}

function OverlayOptions() {
  const editor = useEditor();
  const selection = editor.selection;
  if (selection?.kind !== "overlay") return <NothingSelected>Choose a session or toast overlay from the Frame Overlays panel on the left, or click an overlay in the live Preview, to start editing.</NothingSelected>;
  const overlay = selection.overlay;
  const dialog = DIALOG_OF[overlay];
  if (dialog) {
    const copy = editor.present.sessionLanguage[dialog];
    const path = `sessionLanguage.${dialog}`;
    const set = (field: "title" | "message" | "primary" | "secondary", value: string) => editor.edit((draft) => void (draft.sessionLanguage[dialog][field] = value), `${path}.${field}`);
    return (
      <div className={styles.options}>
        <div className={styles.optionsHeading}>
          <p className={styles.kicker}>Session Overlay → Slot</p>
          <p className={styles.optionsTitle}>{OVERLAY_LABELS[overlay]}</p>
          <p className={styles.optionsNote}>The same copy as Runtime Configuration → Default Session Language.</p>
        </div>
        <OptionsSection title="Slot options">
          <Switch id={`${overlay}-enabled`} label="Enabled" checked={editor.present.overlays[overlay].visible} onChange={(event) => editor.edit((draft) => void (draft.overlays[overlay].visible = event.target.checked))} />
          <Switch id={`${overlay}-custom`} label="Custom language" description="Off uses the default copy." checked={copy.custom} onChange={(event) => editor.edit((draft) => void (draft.sessionLanguage[dialog].custom = event.target.checked))} />
          {copy.custom && (
            <>
              <TextInput id={`${overlay}-title`} label="Dialog title" value={copy.title} maxLength={LIMITS.dialogTitle} errors={editor.errorsAt(`${path}.title`)} onChange={(event) => set("title", event.target.value)} onBlur={editor.seal} />
              <TextArea id={`${overlay}-message`} label="Dialog message" rows={3} value={copy.message} maxLength={LIMITS.dialogMessage} errors={editor.errorsAt(`${path}.message`)} onChange={(event) => set("message", event.target.value)} onBlur={editor.seal} />
              <TextInput id={`${overlay}-primary`} label={dialog === "systemError" ? "Acknowledge action label" : "Primary action label"} value={copy.primary} errors={editor.errorsAt(`${path}.primary`)} onChange={(event) => set("primary", event.target.value)} onBlur={editor.seal} />
              {dialog !== "systemError" && <TextInput id={`${overlay}-secondary`} label="Secondary action label" value={copy.secondary} errors={editor.errorsAt(`${path}.secondary`)} onChange={(event) => set("secondary", event.target.value)} onBlur={editor.seal} />}
            </>
          )}
        </OptionsSection>
      </div>
    );
  }
  const toastId = overlay as "successToast" | "errorToast";
  const toast = editor.present.overlays[toastId];
  const path = `overlays.${toastId}`;
  return (
    <div className={styles.options}>
      <div className={styles.optionsHeading}>
        <p className={styles.kicker}>Toast Overlay → Slot</p>
        <p className={styles.optionsTitle}>{OVERLAY_LABELS[overlay]}</p>
      </div>
      <OptionsSection title="Slot options">
        <Switch id={`${toastId}-enabled`} label="Enabled" checked={toast.visible} onChange={(event) => editor.edit((draft) => void (draft.overlays[toastId].visible = event.target.checked))} />
        <TextInput id={`${toastId}-title`} label="Title" value={toast.title} maxLength={LIMITS.dialogTitle} errors={editor.errorsAt(`${path}.title`)} onChange={(event) => editor.edit((draft) => void (draft.overlays[toastId].title = event.target.value), `${path}.title`)} onBlur={editor.seal} />
        <TextArea id={`${toastId}-message`} label="Message" rows={2} value={toast.message} maxLength={LIMITS.dialogMessage} errors={editor.errorsAt(`${path}.message`)} onChange={(event) => editor.edit((draft) => void (draft.overlays[toastId].message = event.target.value), `${path}.message`)} onBlur={editor.seal} />
        <Switch id={`${toastId}-auto`} label="Dismisses itself" checked={toast.autoDismiss} onChange={(event) => editor.edit((draft) => void (draft.overlays[toastId].autoDismiss = event.target.checked))} />
        {toast.autoDismiss && (
          <TextInput id={`${toastId}-seconds`} label="Dismiss after (seconds)" type="number" inputMode="numeric" value={String(toast.seconds)} errors={editor.errorsAt(`${path}.seconds`)} description={`From ${LIMITS.toastSecondsMin} to ${LIMITS.toastSecondsMax} seconds.`} onChange={(event) => editor.edit((draft) => void (draft.overlays[toastId].seconds = Number.parseInt(event.target.value, 10) || 0), `${path}.seconds`)} onBlur={editor.seal} />
        )}
      </OptionsSection>
    </div>
  );
}
