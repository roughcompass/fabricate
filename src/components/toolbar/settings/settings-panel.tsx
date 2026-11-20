"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, Select, TextArea, TextInput } from "@/components/ui/form";
import { useTargetDocument } from "../target-document";
import { ToolPanel } from "../tool-panel";
import { useToolbarView } from "../view-context";
import { BUS_KIND_LABELS, SEND_TARGETS, SEND_TARGET_LABELS, type SendErrors, type SendTarget, busTime } from "./bus";
import { useSettings } from "./settings-state";
import { ACCENTS, CORNERS, DENSITIES, MODES, type ThemeChoice, usesNextTheme } from "./theme";
import styles from "./settings.module.css";

const OWN = "own";
const ALL = "";

const capitalized = (value: string) => `${value[0]!.toUpperCase()}${value.slice(1)}`;

/**
 * The Settings tool (restore-toolbar-tools-and-branch-previews, design
 * decision 11; template-demo/runtime-settings spec): the Theme section, for
 * applications whose Profile shows a Salt provider, then the Event bus log
 * and its Send an event form.
 */
export function SettingsPanel() {
  return (
    <ToolPanel title="Settings" description="The Salt theme of this view, and the page's event bus." wide>
      <ThemeSection />
      <BusLog />
      <SendForm />
    </ToolPanel>
  );
}

function ThemeSection() {
  const settings = useSettings();
  const view = useToolbarView();
  const { document } = useTargetDocument();
  const { theme } = settings;
  const choose = (setting: keyof ThemeChoice, value: string) => {
    const { [setting]: _dropped, ...rest } = theme;
    settings.setTheme(value === OWN ? rest : { ...rest, [setting]: value });
  };
  const group = (setting: keyof ThemeChoice, legend: string, values: readonly string[]) => (
    <ChoiceGroup
      key={`${setting}:${theme[setting] ?? OWN}`}
      id={`theme-${setting}`}
      name={`theme-${setting}`}
      legend={legend}
      type="radio"
      columns
      selected={[theme[setting] ?? OWN]}
      onChange={(event) => choose(setting, event.currentTarget.value)}
      choices={[{ value: OWN, label: "Application's own" }, ...values.map((value) => ({ value, label: capitalized(value) }))]}
    />
  );
  return (
    <section className={styles.section} aria-labelledby="settings-theme-title">
      <h3 id="settings-theme-title" className={styles.sectionTitle}>
        Theme
      </h3>
      {settings.salt ? (
        <>
          {group("mode", "Mode", MODES)}
          {group("density", "Density", DENSITIES)}
          {usesNextTheme(document) && (
            <>
              {group("accent", "Accent", ACCENTS)}
              {group("corner", "Corner", CORNERS)}
            </>
          )}
          <p className={styles.muted} data-theme-limits="">
            The switch changes Salt&apos;s styles only. Code that reads the theme from JavaScript, the application&apos;s own theme setting, and anything Salt doesn&apos;t style keep the application&apos;s choice.
          </p>
        </>
      ) : (
        <p className={styles.muted} data-theme-unavailable="">{`The theme switch needs a Salt provider, which ${view.name}'s Profile doesn't show.`}</p>
      )}
    </section>
  );
}

function BusLog() {
  const { bus, clearBus } = useSettings();
  const [filter, setFilter] = useState(ALL);
  const names = [...new Set(bus.map((entry) => entry.name))].sort();
  const shown = bus.filter((entry) => filter === ALL || entry.name === filter);
  return (
    <section className={styles.section} aria-labelledby="settings-bus-title">
      <div className={styles.sectionHeader}>
        <h3 id="settings-bus-title" className={styles.sectionTitle}>
          Event bus
        </h3>
        <div className={styles.actions}>
          <Select id="bus-filter" label="Filter by name" hideLabel size="sm" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} options={[{ value: ALL, label: "All events" }, ...names.map((name) => ({ value: name, label: name }))]} />
          <Button size="sm" onClick={clearBus} disabled={bus.length === 0}>
            Clear log
          </Button>
        </div>
      </div>
      <p className={styles.muted} data-bus-limits="">
        The latest 200 events the page dispatched on its window and document, the messages its window received, and the messages it posted to this page, newest first. The browser&apos;s own events, events on other elements, broadcast channels, buses kept in JavaScript objects, messages between other frames, and anything sent before the toolbar attached to the page aren&apos;t logged; a script early in the page&apos;s head can run before it attaches. The log starts over when another page loads in the frame, and is never saved or shared.
      </p>
      {shown.length ? (
        <ol className={styles.log} aria-label="Event bus entries">
          {shown.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`} className={styles.entry} data-bus-kind={entry.kind} data-bus-name={entry.name} data-bus-from={entry.from}>
              <span className={styles.entryHeader}>
                <span>
                  <span className={styles.kind}>{BUS_KIND_LABELS[entry.kind]}</span> <code className={styles.name}>{entry.name}</code>
                </span>
                <span className={styles.time}>{busTime(entry.timeMs)}</span>
              </span>
              <code className={styles.detail}>{entry.detail}</code>
              <span className={styles.from}>{entry.from === "toolbar" ? "Sent by the toolbar" : "From the application"}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>{filter === ALL ? "Nothing logged yet. Use the application, or send an event below." : `Nothing named ${filter} logged yet.`}</p>
      )}
    </section>
  );
}

function SendForm() {
  const settings = useSettings();
  const [target, setTarget] = useState<SendTarget>("window");
  const [errors, setErrors] = useState<SendErrors>({});
  const [sent, setSent] = useState<string | null>(null);
  return (
    <form
      className={styles.section}
      aria-labelledby="settings-send-title"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const name = String(data.get("name") ?? "");
        const result = settings.send({ target, name, detail: String(data.get("detail") ?? "") });
        if (!result.ok) {
          setErrors(result.errors);
          setSent(null);
          const field = event.currentTarget.querySelector<HTMLElement>(result.errors.name ? "#bus-name" : "#bus-detail");
          field?.focus();
          return;
        }
        setErrors({});
        setSent(target === "message" ? "Sent a message to the page." : `Sent ${name.trim()} on the ${target}.`);
      }}
    >
      <h3 id="settings-send-title" className={styles.sectionTitle}>
        Send an event
      </h3>
      <Select id="bus-target" label="Send as" value={target} onChange={(event) => setTarget(event.currentTarget.value as SendTarget)} options={SEND_TARGETS.map((value) => ({ value, label: SEND_TARGET_LABELS[value] }))} />
      {target !== "message" && <TextInput id="bus-name" name="name" label="Event name" mono autoComplete="off" spellCheck={false} errors={errors.name} maxLength={100} />}
      <TextArea id="bus-detail" name="detail" label="Detail" description={target === "message" ? "JSON the page receives as the message's data." : "JSON the event carries as its detail."} rows={3} defaultValue="{}" errors={errors.detail} spellCheck={false} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" icon="arrowRight">
          Send event
        </Button>
        <p className={styles.muted} role="status">
          {sent ?? ""}
        </p>
      </div>
    </form>
  );
}
