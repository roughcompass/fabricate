"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { ChoiceGroup, FormAlert, TextInput } from "@/components/ui/form";
import { routes } from "@/lib/web/routes";
import type { CallOutcome } from "../routing/mock-log";
import type { MockLatency } from "../routing/table";
import { useTargetDocument } from "../target-document";
import { ToolPanel } from "../tool-panel";
import { useToolbarView } from "../view-context";
import { type ActiveMocks, useData } from "./data-state";
import { SCREENSHOTS_STILL_APPLY, WEBSOCKETS_NOT_MOCKED } from "./mock-refusals";
import { OUTCOMES, OUTCOME_LABELS, type RequestRow, canCreateRule, outcomeCounts } from "./request-log";
import { RuleForm } from "./rule-form";
import styles from "./data.module.css";

const NONE = "none";

const LATENCIES: readonly { value: MockLatency; label: string; description: string }[] = [
  { value: "off", label: "Off", description: "Mocked answers come at once." },
  { value: "recorded", label: "As recorded", description: "Each mocked answer waits as long as its response was recorded taking, up to 10 seconds." },
  { value: "slow", label: "Slow", description: "Each mocked answer waits 2 seconds." },
];

/** Where the active set came from, in words. */
function sourceText(active: ActiveMocks): string {
  switch (active.source) {
    case "share":
      return active.set ? "From the share link that opened this view. Choosing here applies your own choice instead." : "The share link that opened this view chose None. Choosing here applies your own choice instead.";
    case "choice":
      return "Your choice for this view.";
    case "preview":
      return active.set ? "The saved preview's default." : "The saved preview's default: None.";
    case "application":
      return "The application's default.";
    case "none":
      return "The application has no default mock set, so calls go to their own addresses.";
  }
}

/**
 * The Data tool (add-mock-sets, design decision 15; template-demo/mock-data
 * spec): the mock set this view applies, and where it came from; the
 * latency mocked answers wait; the frame's API calls and what answered
 * each, with Create rule for a call no rule answered; Manage mock sets; and
 * the limits that apply. Every text is a draft until DE design and PMs
 * approve it.
 */
export function DataPanel() {
  const data = useData();
  const view = useToolbarView();
  const onOpen = useEffectEvent(() => data.refresh());
  useEffect(() => onOpen(), []);

  return (
    <ToolPanel title="Data" description={`The answers ${view.name}'s API calls get in this view: its own network, or one of its mock sets.`} wide>
      <SetChoice />
      {data.active.set && !data.refusal && <LatencyChoice />}
      <Requests />
      <div className={styles.actions}>
        <ButtonLink href={routes.applicationMockSets(view.slug)} target="_blank" rel="noopener" size="sm" icon="external" data-manage-mock-sets="">
          Manage mock sets
        </ButtonLink>
      </div>
    </ToolPanel>
  );
}

function SetChoice() {
  const data = useData();
  const [error, setError] = useState<string | null>(null);
  if (data.refusal)
    return (
      <section className={styles.section} aria-labelledby="data-set-title">
        <h3 id="data-set-title" className={styles.sectionTitle}>
          Mock set
        </h3>
        <p className={styles.notice} data-mock-refusal="">{`${data.refusal} ${SCREENSHOTS_STILL_APPLY}`}</p>
      </section>
    );
  return (
    <section className={styles.section} aria-label="Mock set">
      <ChoiceGroup
        key={`set-${data.active.set?.publicId ?? NONE}-${data.active.source}-${data.sets.map((set) => `${set.publicId}:${set.ruleCount}`).join("|")}`}
        id="data-set"
        name="data-set"
        legend="Mock set"
        type="radio"
        selected={[data.active.set?.publicId ?? NONE]}
        errors={error ? [error] : undefined}
        onChange={(event) => {
          const value = event.currentTarget.value;
          void data.choose(value === NONE ? null : value).then(setError);
        }}
        choices={[
          { value: NONE, label: "None: the application's own network", description: "Every call goes to its own address." },
          ...data.sets.map((set) => ({ value: set.publicId, label: set.name, description: [countLabel(set.ruleCount, "rule"), set.isDefault ? "Default" : null].filter(Boolean).join(" · ") })),
        ]}
      />
      <p className={styles.muted} data-mock-source={data.active.source}>
        {sourceText(data.active)}
      </p>
      {data.problem && (
        <p className={styles.notice} role="status" data-mock-problem="">
          {`${data.problem} The frame loaded without the mock set.`}
        </p>
      )}
      {data.registered && (
        <p className={styles.notice} role="status" data-mock-registered="">
          {`${data.registered} ${SCREENSHOTS_STILL_APPLY}`}
        </p>
      )}
    </section>
  );
}

function LatencyChoice() {
  const data = useData();
  return (
    <section className={styles.section} aria-label="Latency">
      <ChoiceGroup
        key={`latency-${data.latency}`}
        id="data-latency"
        name="data-latency"
        legend="Latency"
        type="radio"
        selected={[data.latency]}
        onChange={(event) => data.setLatency(event.currentTarget.value as MockLatency)}
        choices={LATENCIES.map(({ value, label, description }) => ({ value, label, description }))}
        description="Calls that go to their own addresses never wait. Kept in this browser for this view."
      />
    </section>
  );
}

type Filter = CallOutcome | "all";

function Requests() {
  const data = useData();
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<RequestRow | null>(null);
  const counts = outcomeCounts(data.requests);
  const shown = data.requests.filter((row) => filter === "all" || row.outcome === filter);
  const detail = data.requests.find((row) => row.id === selected) ?? null;

  return (
    <section className={styles.section} aria-labelledby="data-requests-title">
      <div className={styles.sectionHeader}>
        <h3 id="data-requests-title" className={styles.sectionTitle}>
          Requests
        </h3>
        {data.applies && (
          <Button
            size="sm"
            onClick={() => {
              data.clearRequests();
              setSelected(null);
            }}
            disabled={data.requests.length === 0}
          >
            Clear requests
          </Button>
        )}
      </div>
      {data.applies ? (
        <>
          <p className={styles.muted} data-requests-note="">{`The page's fetch, XHR, and event-stream calls since it loaded, newest first, up to 500, with what answered each. ${WEBSOCKETS_NOT_MOCKED} The list shows each WebSocket connection, never its messages.`}</p>
          <div role="group" aria-label="Filter requests" className={styles.filters}>
            {(["all", ...OUTCOMES] as const).map((outcome) => (
              <button key={outcome} type="button" className={styles.filter} aria-pressed={filter === outcome} data-filter={outcome} onClick={() => setFilter(outcome)}>
                {outcome === "all" ? "All" : OUTCOME_LABELS[outcome]}
                <span className={styles.filterCount}>{outcome === "all" ? data.requests.length : counts[outcome]}</span>
              </button>
            ))}
          </div>
          {shown.length ? (
            <ol className={styles.requests} aria-label="Requests">
              {shown.map((row) => (
                <li key={row.id} data-request={`${row.method} ${row.url}`} data-request-outcome={row.outcome}>
                  <button type="button" className={styles.request} aria-pressed={row.id === selected} onClick={() => setSelected(row.id === selected ? null : row.id)}>
                    <span className={styles.requestHeader}>
                      <code className={styles.method}>{row.method}</code>
                      <code className={styles.address}>{row.url}</code>
                    </span>
                    <span className={styles.requestMeta}>
                      <span data-request-summary="">{row.summary}</span>
                      <span>{row.durationMs === null ? row.status : `${row.status} · ${row.durationMs} ms`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.muted}>{data.requests.length ? `No ${OUTCOME_LABELS[filter as CallOutcome].toLowerCase()} calls.` : "No API calls since the page loaded."}</p>
          )}
          {detail && <RequestDetail row={detail} onCreate={() => setCreating(detail)} />}
          {creating && creating.call && data.active.set && (
            <RuleForm
              key={creating.id}
              call={creating.call}
              set={data.active.set}
              onDone={() => {
                setCreating(null);
              }}
            />
          )}
        </>
      ) : (
        <NoSet />
      )}
    </section>
  );
}

function RequestDetail({ row, onCreate }: { row: RequestRow; onCreate: () => void }) {
  const view = useToolbarView();
  const data = useData();
  const rule = row.call?.rule ?? null;
  return (
    <div className={styles.detail} role="group" aria-label={`${row.method} ${row.url}`} data-request-detail="">
      <dl className={styles.facts}>
        <dt>Address</dt>
        <dd>
          <code className={styles.address}>{row.url}</code>
        </dd>
        <dt>What answered</dt>
        <dd>{rule ? `${row.summary}, response ${rule.response}` : row.summary}</dd>
        <dt>Status</dt>
        <dd>{row.status}</dd>
        {row.durationMs !== null && (
          <>
            <dt>Time</dt>
            <dd>{`${row.durationMs} ms`}</dd>
          </>
        )}
      </dl>
      {row.call === null && <p className={styles.muted}>{WEBSOCKETS_NOT_MOCKED}</p>}
      <div className={styles.actions}>
        {rule && data.active.set && (
          <ButtonLink href={routes.mockRule(view.slug, row.call!.set, rule.id)} target="_blank" rel="noopener" size="sm" icon="external">
            Edit rule
          </ButtonLink>
        )}
        {canCreateRule(row) && (
          <Button size="sm" icon="plus" onClick={onCreate}>
            Create rule
          </Button>
        )}
      </div>
    </div>
  );
}

/** With no set applying: what Data would list, and a set to start. */
function NoSet() {
  const data = useData();
  const view = useToolbarView();
  const target = useTargetDocument();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  if (data.refusal) return <p className={styles.muted}>Calls are listed while a mock set applies.</p>;
  return (
    <>
      <p className={styles.muted} data-requests-note="">
        {data.active.set ? "Calls are listed once the mock set applies." : `Calls are listed while a mock set applies. A mock set answers ${view.name}'s API calls with recorded or written responses, in this view and its screenshots.`}
      </p>
      {!data.active.set &&
        (creating ? (
          <form
            className={styles.form}
            aria-label="New mock set"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) {
                setErrors({ name: ["Enter a name"] });
                return;
              }
              setSaving(true);
              void data.createSet(name).then((result) => {
                setSaving(false);
                if (result.ok) setCreating(false);
                else setErrors(result.errors);
              });
            }}
          >
            {errors.base && (
              <FormAlert id="data-new-set-alert" title="The mock set was not created">
                {errors.base.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </FormAlert>
            )}
            <TextInput id="data-new-set-name" name="name" label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={60} autoComplete="off" errors={errors.name} description={`It's empty at first, and applies to this view of ${view.name} once created.`} />
            <div className={styles.actions}>
              <Button type="submit" variant="primary" disabled={saving || target.state !== "ready"}>
                Create mock set
              </Button>
              <Button variant="tertiary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className={styles.actions}>
            <Button size="sm" icon="plus" onClick={() => setCreating(true)}>
              New mock set
            </Button>
          </div>
        ))}
    </>
  );
}
