"use client";

import { useState, useSyncExternalStore } from "react";
import { ToolPanel } from "@/components/toolbar/tool-panel";
import { Button } from "@/components/ui/button";
import { Checkbox, ChoiceGroup, Select, TextArea, TextInput } from "@/components/ui/form";
import { memberById } from "@/lib/demo/catalog";
import type { BusMessage } from "../runtime/bus";
import { useRuntime, useViewState } from "../runtime/runtime-context";
import { parsePayload, topicError } from "./bus-publish";
import { useHints } from "./guided-hints";
import styles from "./settings.module.css";

const ALL_TOPICS = "";
const OTHER_TOPIC = "__other";

function formatPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function formatTime(ms: number): string {
  return `+${(ms / 1000).toFixed(2)} s`;
}

/**
 * The Settings tool: the running application's theme, applied to every
 * microfrontend at once, and the event bus, whose messages the visitor can
 * watch and publish. Who is signed in is the Session tool's.
 */
export function SettingsPanel() {
  const { app, store, bus } = useRuntime();
  const view = useViewState();
  const [subscribe] = useState(() => (listener: () => void) => bus.onMessage(() => listener()));
  const messages = useSyncExternalStore(subscribe, bus.messages, bus.messages);
  const [filter, setFilter] = useState(ALL_TOPICS);
  const [topicChoice, setTopicChoice] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ topic?: string[]; payload?: string[] }>({});
  const [published, setPublished] = useState<BusMessage | null>(null);

  const knownTopics = [...new Set([...app.members.flatMap((member) => [...(member.publishes ?? []), ...(member.subscribes ?? [])]), ...bus.topics()])].sort();
  const chosenTopic = topicChoice ?? knownTopics[0] ?? OTHER_TOPIC;
  const loggedTopics = [...new Set(messages.map((message) => message.topic))].sort();
  const shown = [...messages].reverse().filter((message) => filter === ALL_TOPICS || message.topic === filter);
  const hints = useHints();
  const party = (id: string) => (id === "toolbar" ? "Toolbar" : (memberById(app, id)?.name ?? id));

  return (
    <ToolPanel title="Settings" description="Runtime configuration for this application. Changes apply to every microfrontend immediately." wide>
      <ChoiceGroup
        key={`theme-${view.theme}`}
        id="runtime-theme"
        name="runtime-theme"
        legend="Theme"
        type="radio"
        columns
        selected={[view.theme]}
        onChange={(event) => store.setTheme(event.currentTarget.value === "dark" ? "dark" : "light")}
        choices={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />

      <section className={styles.section} aria-labelledby="bus-log-title">
        <div className={styles.sectionHeader}>
          <h3 id="bus-log-title" className={styles.sectionTitle}>
            Event bus
          </h3>
          <Select id="bus-filter" label="Filter by topic" hideLabel size="sm" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} options={[{ value: ALL_TOPICS, label: "All topics" }, ...loggedTopics.map((topic) => ({ value: topic, label: topic }))]} />
        </div>
        {shown.length ? (
          <ol className={styles.log} aria-label="Event bus messages">
            {shown.map((message) => (
              <li key={message.id} className={styles.message} data-bus-topic={message.topic} data-bus-publisher={message.publisher}>
                <span className={styles.messageHeader}>
                  <code className={styles.topic}>{message.topic}</code>
                  <span className={styles.time}>{formatTime(message.time)}</span>
                </span>
                <code className={styles.payload}>{formatPayload(message.payload)}</code>
                <span className={styles.route}>{`From ${party(message.publisher)} to ${message.receivers.length ? message.receivers.map(party).join(", ") : "no subscribers"}`}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.muted}>{filter === ALL_TOPICS ? "No messages yet. Use the application, or publish one below." : `No messages on ${filter} yet.`}</p>
        )}
      </section>

      <form
        className={styles.section}
        aria-labelledby="bus-publish-title"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const topic = (chosenTopic === OTHER_TOPIC ? String(data.get("topic") ?? "") : chosenTopic).trim();
          const parsed = parsePayload(String(data.get("payload") ?? ""));
          const next: typeof errors = {};
          const invalidTopic = topicError(topic);
          if (invalidTopic) next.topic = [invalidTopic];
          if (!parsed.ok) next.payload = [parsed.error];
          setErrors(next);
          if (next.topic || !parsed.ok) {
            setPublished(null);
            return;
          }
          setPublished(bus.publish(topic, parsed.payload, "toolbar"));
        }}
      >
        <h3 id="bus-publish-title" className={styles.sectionTitle}>
          Publish a message
        </h3>
        <Select
          id="bus-topic-choice"
          label="Topic"
          value={chosenTopic}
          onChange={(event) => setTopicChoice(event.currentTarget.value)}
          options={[...knownTopics.map((topic) => ({ value: topic, label: topic })), { value: OTHER_TOPIC, label: "Another topic…" }]}
        />
        {chosenTopic === OTHER_TOPIC && <TextInput id="bus-topic" name="topic" label="Topic name" mono errors={errors.topic} maxLength={60} />}
        <TextArea id="bus-payload" name="payload" label="Payload" description="JSON delivered to the topic's subscribers." rows={3} defaultValue="{}" errors={errors.payload} />
        <div className={styles.actions}>
          <Button type="submit" variant="primary" icon="arrowRight">
            Publish message
          </Button>
          <p className={styles.muted} role="status">
            {published ? `Published to ${published.receivers.length} ${published.receivers.length === 1 ? "subscriber" : "subscribers"}.` : ""}
          </p>
        </div>
      </form>

      {hints && (
        <section className={styles.section} aria-labelledby="hints-title">
          <h3 id="hints-title" className={styles.sectionTitle}>
            Guided hints
          </h3>
          <Checkbox id="hints-on" label="Show guided hints" description="Short tips on the create page and in running applications, for this workspace." checked={!hints.state.off} onChange={(event) => hints.act(event.currentTarget.checked ? "on" : "off")} />
          <div className={styles.actions}>
            <Button icon="undo" onClick={() => hints.act("replay")} disabled={hints.state.off}>
              Replay hints
            </Button>
          </div>
        </section>
      )}
    </ToolPanel>
  );
}
