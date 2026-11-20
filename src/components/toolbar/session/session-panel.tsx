"use client";

import { useEffect, useEffectEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { ChoiceGroup, FormAlert, Select, TextInput } from "@/components/ui/form";
import { RelativeTime } from "@/components/ui/relative-time";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { ToolPanel } from "../tool-panel";
import { useToolbarView } from "../view-context";
import { summarizeEntries } from "./session-apply";
import { type Errors, type Preset, type PresetDraft, useSession } from "./session-state";
import styles from "./session.module.css";

const OWN = "own";
const NEW_BUTTON = "session-new-preset";
const STORES = [
  { value: "local", label: "Local storage" },
  { value: "session", label: "Session storage" },
  { value: "cookie", label: "Cookie" },
  { value: "query", label: "Query parameter" },
];

/** The note the panel and the form give before anything else: presets aren't secret. */
const NOTE = "Presets are stored unencrypted and visible to everyone who can open this application, so never put real secrets in them.";

/** Focus goes back to New preset once the form that replaced it is gone. */
const focusNewButton = () => window.requestAnimationFrame(() => document.getElementById(NEW_BUTTON)?.focus());

/**
 * The Session tool (restore-toolbar-tools-and-branch-previews, design
 * decision 11; template-demo/session-presets spec): what the application
 * starts with, its presets, which everyone who opens it shares, and the
 * form that creates or edits one.
 */
export function SessionPanel() {
  const session = useSession();
  const view = useToolbarView();
  const [editing, setEditing] = useState<{ preset: Preset | null; key: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onOpen = useEffectEvent(() => session.refresh());
  useEffect(() => onOpen(), []);

  return (
    <ToolPanel title="Session" description={`What ${view.name} starts with in this browser: its own storage, or one of its presets.`} wide>
      <p className={styles.note} data-session-note="">
        {NOTE}
      </p>
      <ChoiceGroup
        key={`start-${session.chosen ?? OWN}-${session.presets.map((preset) => `${preset.publicId}:${preset.lockVersion}`).join("|")}`}
        id="session-start"
        name="session-start"
        legend="Start with"
        type="radio"
        selected={[session.chosen ?? OWN]}
        errors={error ? [error] : undefined}
        onChange={(event) => {
          const value = event.currentTarget.value;
          void session.choose(value === OWN ? null : value).then(setError);
        }}
        choices={[
          { value: OWN, label: "The application's own storage", description: "Whatever this browser already holds for it." },
          ...session.presets.map((preset) => ({ value: preset.publicId, label: preset.name, description: summarizeEntries(preset.entries, countLabel) })),
        ]}
      />

      <section className={styles.section} aria-labelledby="session-presets-title">
        <div className={styles.sectionHeader}>
          <h3 id="session-presets-title" className={styles.sectionTitle}>
            Presets
          </h3>
          {!editing && (
            <Button id={NEW_BUTTON} size="sm" icon="plus" onClick={() => setEditing({ preset: null, key: Date.now() })}>
              New preset
            </Button>
          )}
        </div>
        {session.presets.length ? (
          <ul className={styles.list} aria-label="Presets">
            {session.presets.map((preset) => (
              <PresetRow key={preset.publicId} preset={preset} onEdit={() => setEditing({ preset, key: Date.now() })} />
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>{`No presets yet. A preset sets storage, cookies, and query parameters, such as a signed-in user or a feature flag, for everyone who opens ${view.name}.`}</p>
        )}
        {editing && (
          <PresetForm
            key={editing.key}
            preset={editing.preset}
            onDone={() => {
              setEditing(null);
              focusNewButton();
            }}
          />
        )}
      </section>
    </ToolPanel>
  );
}

function PresetRow({ preset, onEdit }: { preset: Preset; onEdit: () => void }) {
  const session = useSession();
  const view = useToolbarView();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelId = useId();
  useEffect(() => {
    if (confirming) document.getElementById(cancelId)?.focus();
  }, [confirming, cancelId]);
  return (
    <li className={styles.row} data-preset={preset.name}>
      <div className={styles.rowMain}>
        <span className={styles.rowText}>
          <span className={styles.rowName}>{preset.name}</span>
          <span className={styles.rowMeta}>
            {"Changed "}
            <RelativeTime value={new Date(preset.updatedAt)} />
            {preset.updatedByName ? ` by ${preset.updatedByName}` : ""}
          </span>
        </span>
        <Button size="sm" variant="tertiary" icon="edit" label={`Edit ${preset.name}`} onClick={onEdit} />
        <Button size="sm" variant="tertiary" icon="trash" label={`Delete ${preset.name}`} onClick={() => setConfirming(true)} />
      </div>
      {confirming && (
        <div className={styles.confirm} role="group" aria-label={`Delete ${preset.name}?`}>
          <p className={styles.muted}>{`Delete ${preset.name}? It's removed for everyone who opens ${view.name}.`}</p>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                void session.remove(preset).then((reason) => {
                  setError(reason);
                  if (!reason) focusNewButton();
                })
              }
            >
              Delete preset
            </Button>
            <Button id={cancelId} size="sm" variant="tertiary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

interface EntryDraft {
  readonly id: number;
  readonly store: string;
  readonly name: string;
  readonly value: string;
}

let nextEntry = 1;
const draftsOf = (preset: Preset | null): EntryDraft[] => (preset ? preset.entries.map((entry) => ({ id: nextEntry++, ...entry })) : [{ id: nextEntry++, store: "local", name: "", value: "" }]);

/**
 * Creating or editing a preset. The name is checked here first, then
 * everything by the server; an edit someone else made first is refused, and
 * the form then shows the newer entries.
 */
function PresetForm({ preset, onDone }: { preset: Preset | null; onDone: () => void }) {
  const session = useSession();
  const [current, setCurrent] = useState(preset);
  const [entries, setEntries] = useState<EntryDraft[]>(() => draftsOf(preset));
  const [name, setName] = useState(preset?.name ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const alertId = useId();
  const form = useFocusFirstInvalid(errors, alertId);
  const title = current ? `Edit ${current.name}` : "New preset";

  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>("#preset-name")?.focus();
  }, [form]);

  const change = (id: number, field: "store" | "name" | "value", value: string) => setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)));

  const submit = async () => {
    if (!name.trim()) {
      setErrors({ name: ["Enter a name"] });
      return;
    }
    const draft: PresetDraft = { name, entries: entries.map(({ store, name: entryName, value }) => ({ store, name: entryName, value })) };
    setSaving(true);
    const result = await session.save(draft, current);
    setSaving(false);
    if (result.ok) {
      onDone();
      return;
    }
    if (result.current) {
      // Someone else changed it first: the form shows their entries, ready to change again.
      setCurrent(result.current);
      setName(result.current.name);
      setEntries(draftsOf(result.current));
    }
    setErrors(result.errors);
  };

  const cookies = entries.some((entry) => entry.store === "cookie");
  return (
    <form
      ref={form}
      className={styles.form}
      aria-label={title}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h4 className={styles.formTitle}>{title}</h4>
      <p className={styles.note}>{NOTE}</p>
      {(errors.base || errors.entries) && (
        <FormAlert id={alertId} title={current ? "The preset was not saved" : "The preset was not created"}>
          {[...(errors.base ?? []), ...(errors.entries ?? [])].map((message) => (
            <p key={message}>{message}</p>
          ))}
        </FormAlert>
      )}
      <TextInput id="preset-name" name="name" label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={60} autoComplete="off" errors={errors.name} />
      <ol className={styles.entries} aria-label="Entries">
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <fieldset className={styles.entry}>
              <legend className={styles.entryLegend}>{`Entry ${index + 1}`}</legend>
              <Select id={`preset-entry-${entry.id}-store`} label="Kind" value={entry.store} onChange={(event) => change(entry.id, "store", event.currentTarget.value)} options={STORES} errors={errors[`entries.${index}.store`]} />
              <TextInput id={`preset-entry-${entry.id}-name`} label="Name" mono value={entry.name} onChange={(event) => change(entry.id, "name", event.currentTarget.value)} maxLength={256} errors={errors[`entries.${index}.name`]} />
              <TextInput id={`preset-entry-${entry.id}-value`} label="Value" mono value={entry.value} onChange={(event) => change(entry.id, "value", event.currentTarget.value)} maxLength={4096} errors={errors[`entries.${index}.value`]} />
              {entries.length > 1 && (
                <div>
                  <Button size="sm" variant="tertiary" icon="trash" onClick={() => setEntries((list) => list.filter((each) => each.id !== entry.id))}>
                    {`Remove entry ${index + 1}`}
                  </Button>
                </div>
              )}
            </fieldset>
          </li>
        ))}
      </ol>
      <div>
        <Button size="sm" icon="plus" onClick={() => setEntries((list) => [...list, { id: nextEntry++, store: "local", name: "", value: "" }])} disabled={entries.length >= 50}>
          Add entry
        </Button>
      </div>
      {cookies && <p className={styles.muted}>Cookies are set on the Frontend Registry&apos;s origin, for this build&apos;s path only. Cookies for the application&apos;s own domains, and HttpOnly cookies, can&apos;t be set, so a preset can&apos;t stand in for cookies its backend sets.</p>}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={saving}>
          {current ? "Save preset" : "Create preset"}
        </Button>
        <Button variant="tertiary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
