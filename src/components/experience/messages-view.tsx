"use client";

import { useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Select, TextArea, TextInput } from "@/components/ui/form";
import { Icon, type IconName } from "@/components/ui/icon";
import { Panel } from "@/components/ui/panel";
import { Tag } from "@/components/ui/tag";
import { LIMITS, MESSAGE_STATE_LABELS, SEVERITIES, SEVERITY_LABELS, type Severity, type SystemMessage, activeMessage, messageState } from "@/lib/experience/document";
import { useEditor } from "./store";
import styles from "./messages.module.css";
import { editorBase } from "@/lib/portals/paths";

const SEVERITY_ICONS: Record<Severity, IconName> = { info: "info", warning: "alert", error: "xCircle" };
const when = (value: string) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function scheduleOf(message: SystemMessage): string {
  if (message.startsAt && message.endsAt) return `${when(message.startsAt)} to ${when(message.endsAt)}`;
  if (message.startsAt) return `From ${when(message.startsAt)}`;
  if (message.endsAt) return `Until ${when(message.endsAt)}`;
  return "Always on";
}

const newId = () => `msg_${Math.random().toString(36).slice(2, 10)}`;

/**
 * The System messages editor (experience-frame spec, "The System messages
 * editor manages the banner's messages"): every message with its on switch,
 * severity, copy, schedule, state, and actions, and a side panel to edit one.
 * The banner shows the first active message, so order matters. Every change
 * is a pending change.
 */
export function MessagesView() {
  const editor = useEditor();
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SystemMessage | null>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const { messages } = editor.present;
  const live = activeMessage(editor.present);
  const base = editorBase(editor.portal.publicId);
  const index = messages.findIndex((message) => message.id === editing);
  const current = index >= 0 ? messages[index]! : null;

  const update = (id: string, change: (draft: SystemMessage) => void, coalesce?: string) =>
    editor.edit((draft) => {
      const target = draft.messages.find((message) => message.id === id);
      if (target) change(target);
    }, coalesce);
  const move = (from: number, by: -1 | 1) =>
    editor.edit((draft) => {
      [draft.messages[from], draft.messages[from + by]] = [draft.messages[from + by]!, draft.messages[from]!];
    });

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <ButtonLink href={`${base}/frame-zones`} variant="tertiary" size="sm" icon="arrowLeft">
          Back to workspace
        </ButtonLink>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>System messages</h2>
          <p className={styles.summary} data-messages-summary="">
            {`${messages.length} message${messages.length === 1 ? "" : "s"}`}
            {live ? ` · ${live.title} is live` : " · none is live"}
          </p>
          <button
            type="button"
            {...buttonProps("primary", "sm")}
            onClick={() => {
              const id = newId();
              editor.edit((draft) => void draft.messages.push({ id, title: "New message", description: "", severity: "info", dismissible: true, enabled: false, startsAt: null, endsAt: null }));
              setEditing(id);
            }}
          >
            <Icon name="plus" size={14} />
            Add message
          </button>
        </div>
        <Panel flush>
          {messages.length === 0 ? (
            <EmptyState title="No system messages" icon="info">
              The banner stays hidden until a message is active. Add one for maintenance windows, environment notices, or announcements.
            </EmptyState>
          ) : (
            <table className={styles.table} aria-label="System messages">
              <thead>
                <tr>
                  <th scope="col">On</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Message</th>
                  <th scope="col">Schedule</th>
                  <th scope="col">State</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message, position) => {
                  const state = messageState(message);
                  return (
                    <tr key={message.id} data-message={message.id} data-editing={message.id === editing ? "" : undefined}>
                      <td data-label="On">
                        <Checkbox id={`${message.id}-on`} label={`${message.title} is on`} hideLabel checked={message.enabled} onChange={(event) => update(message.id, (draft) => void (draft.enabled = event.target.checked))} />
                      </td>
                      <td data-label="Severity">
                        <span className={styles.severity}>
                          <Icon name={SEVERITY_ICONS[message.severity]} size={14} />
                          {SEVERITY_LABELS[message.severity]}
                        </span>
                      </td>
                      <td data-label="Message">
                        <div>
                          <span className={styles.messageTitle}>{message.title}</span>
                          <span className={styles.messageDescription}>{message.description}</span>
                        </div>
                      </td>
                      <td data-label="Schedule" className={styles.schedule}>{scheduleOf(message)}</td>
                      <td data-label="State">
                        <Tag sans>{MESSAGE_STATE_LABELS[state]}</Tag>
                      </td>
                      <td data-label="Actions">
                        <span className={styles.actions}>
                          <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label={`Move ${message.title} up`} disabled={position === 0} onClick={() => move(position, -1)}>
                            <Icon name="arrowUp" size={14} />
                          </button>
                          <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label={`Move ${message.title} down`} disabled={position === messages.length - 1} onClick={() => move(position, 1)}>
                            <Icon name="arrowDown" size={14} />
                          </button>
                          <button type="button" {...buttonProps("tertiary", "sm", true)} aria-label={`Edit ${message.title}`} onClick={() => setEditing(message.id)}>
                            <Icon name="edit" size={14} />
                          </button>
                          <button
                            type="button"
                            {...buttonProps("tertiary", "sm", true)}
                            aria-label={`Delete ${message.title}`}
                            onClick={() => {
                              setDeleting(message);
                              confirm.current?.showModal();
                            }}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
      {current && (
        <aside className={styles.panel} aria-label="Edit message">
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Edit message</h3>
            <Tag sans>{MESSAGE_STATE_LABELS[messageState(current)]}</Tag>
            <button type="button" {...buttonProps("tertiary", "sm")} onClick={() => setEditing(null)}>
              Close
            </button>
          </div>
          <TextInput id="message-title" label="Title" value={current.title} maxLength={LIMITS.messageTitle} errors={editor.errorsAt(`messages.${index}.title`)} onChange={(event) => update(current.id, (draft) => void (draft.title = event.target.value), `messages.${current.id}.title`)} onBlur={editor.seal} />
          <TextArea id="message-description" label="Description" rows={3} value={current.description} maxLength={LIMITS.messageDescription} errors={editor.errorsAt(`messages.${index}.description`)} onChange={(event) => update(current.id, (draft) => void (draft.description = event.target.value), `messages.${current.id}.description`)} onBlur={editor.seal} />
          <Select id="message-severity" label="Severity" value={current.severity} options={SEVERITIES.map((value) => ({ value, label: SEVERITY_LABELS[value] }))} onChange={(event) => update(current.id, (draft) => void (draft.severity = event.target.value as Severity))} />
          <Checkbox id="message-dismissible" label="Dismissible" checked={current.dismissible} onChange={(event) => update(current.id, (draft) => void (draft.dismissible = event.target.checked))} />
          <Checkbox id="message-enabled" label="Enabled" checked={current.enabled} onChange={(event) => update(current.id, (draft) => void (draft.enabled = event.target.checked))} />
          <fieldset className={styles.schedule}>
            <legend className={styles.legend}>Schedule</legend>
            <p className={styles.note}>Leave both empty for an always-on message. Use just the start to begin at a time, or just the end to expire one automatically.</p>
            <TextInput id="message-starts" label="Starts" type="datetime-local" value={current.startsAt ?? ""} errors={editor.errorsAt(`messages.${index}.startsAt`)} onChange={(event) => update(current.id, (draft) => void (draft.startsAt = event.target.value || null))} />
            <TextInput id="message-ends" label="Ends" type="datetime-local" value={current.endsAt ?? ""} errors={editor.errorsAt(`messages.${index}.endsAt`)} onChange={(event) => update(current.id, (draft) => void (draft.endsAt = event.target.value || null))} />
            <button type="button" {...buttonProps("tertiary", "sm")} disabled={!current.startsAt && !current.endsAt} onClick={() => update(current.id, (draft) => { draft.startsAt = null; draft.endsAt = null; })}>
              Clear schedule
            </button>
          </fieldset>
        </aside>
      )}
      <dialog ref={confirm} className={styles.dialog} aria-labelledby="delete-message-title" onClose={() => setDeleting(null)}>
        <h3 id="delete-message-title" className={styles.dialogTitle}>{`Delete ${deleting?.title ?? "message"}?`}</h3>
        <p className={styles.note}>It leaves the banner&apos;s list when you save. Undo brings it back before then.</p>
        <div className={styles.dialogActions}>
          <button type="button" {...buttonProps("secondary")} autoFocus onClick={() => confirm.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            {...buttonProps("danger")}
            onClick={() => {
              const id = deleting?.id;
              if (id) {
                editor.edit((draft) => void (draft.messages = draft.messages.filter((message) => message.id !== id)));
                if (editing === id) setEditing(null);
              }
              confirm.current?.close();
            }}
          >
            Delete message
          </button>
        </div>
      </dialog>
    </div>
  );
}
