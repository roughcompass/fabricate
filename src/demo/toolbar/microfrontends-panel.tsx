"use client";

import { useState } from "react";
import { ToolPanel } from "@/components/toolbar/tool-panel";
import { useToolbar } from "@/components/toolbar/toolbar-context";
import { setToolbarPrefs, useToolbarPrefs } from "@/components/toolbar/toolbar-prefs";
import { Button } from "@/components/ui/button";
import { Checkbox, ChoiceGroup } from "@/components/ui/form";
import { BRANDS, type EnvironmentId, memberById, routingLabel } from "@/lib/demo/catalog";
import { availableEnvironments, defaultRouting, environmentLabel, environmentName, routingHeaders } from "@/lib/demo/routing";
import { useRouting, useRuntime, useViewState } from "../runtime/runtime-context";
import type { Override } from "../runtime/view-store";
import styles from "./tools.module.css";

/**
 * The Microfrontends panel (template-demo/microfrontends spec): the group's
 * members with where each is served from, and per-member version and
 * environment overrides that apply together with Reload preview.
 */
export function MicrofrontendsPanel({ selected, onSelect }: { selected: string | null; onSelect: (member: string) => void }) {
  const { app, template, store, descriptor } = useRuntime();
  const { overrides } = useViewState();
  const routing = useRouting();
  const prefs = useToolbarPrefs();
  const { setMode, closeTool } = useToolbar();
  const [pending, setPending] = useState<Readonly<Record<string, Override>>>({});
  const current = memberById(app, selected ?? "") ?? app.members.find((member) => member.role === "child")!;
  const choice = pending[current.id] ?? { version: routing[current.id]!.version, environment: routing[current.id]!.environment };
  const pendingCount = Object.keys(pending).length;

  const change = (next: Partial<Override>) => {
    const value = { ...choice, ...next };
    const applied = routing[current.id]!;
    setPending((previous) => {
      const copy = { ...previous };
      if (value.version === applied.version && value.environment === applied.environment) delete copy[current.id];
      else copy[current.id] = value;
      return copy;
    });
  };

  const reload = () => {
    const next: Record<string, Override> = { ...overrides };
    for (const [member, value] of Object.entries(pending)) {
      const fallback = defaultRouting(memberById(app, member)!, descriptor.environment);
      if (value.version === fallback.version && value.environment === fallback.environment) delete next[member];
      else next[member] = value;
    }
    store.applyOverrides(next);
    setPending({});
  };

  return (
    <ToolPanel title="Microfrontends" description={`${BRANDS[template.brand].portalName} · ${app.members.length} members in this group`} wide>
      <ul className={styles.memberList} aria-label="Members">
        {app.members.map((member) => {
          const route = routing[member.id]!;
          return (
            <li key={member.id}>
              <button type="button" className={styles.memberButton} aria-pressed={member.id === current.id} onClick={() => onSelect(member.id)} data-member={member.id}>
                <span className={styles.memberName}>
                  {member.name}
                  {member.role === "default" && <span className={styles.memberRole}>Default application</span>}
                </span>
                <span className={styles.memberMeta}>
                  <code>{route.version}</code>
                  <span>{environmentLabel(route)}</span>
                  {route.reason === "override" && <span className={styles.flag}>Overridden</span>}
                  {pending[member.id] && <span className={styles.flagPending}>Pending</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <section className={styles.memberDetail} aria-labelledby="member-detail-title">
        <h3 id="member-detail-title" className={styles.sectionTitle}>
          {current.name}
        </h3>
        <p className={styles.muted}>{`${current.owner} · ${routingLabel(current)}`}</p>
        <ChoiceGroup
          key={`${current.id}:${choice.version}`}
          id={`version-${current.id}`}
          name={`version-${current.id}`}
          legend="Version"
          type="radio"
          selected={[choice.version]}
          onChange={(event) => change({ version: event.currentTarget.value })}
          choices={current.versions.map((version) => ({
            value: version.version,
            label: `${version.version}${version.prerelease ? " · Prerelease" : ""}${version.version === routing[current.id]!.version ? " · Current" : ""}`,
            description: version.summary,
          }))}
        />
        <ChoiceGroup
          key={`${current.id}:${choice.environment}`}
          id={`environment-${current.id}`}
          name={`environment-${current.id}`}
          legend="Environment"
          type="radio"
          columns
          selected={[choice.environment]}
          onChange={(event) => change({ environment: event.currentTarget.value as EnvironmentId })}
          choices={availableEnvironments(current, descriptor.environment).map((environment) => ({ value: environment, label: environmentName(environment) }))}
        />
      </section>

      <div className={styles.actions}>
        <Button variant="primary" icon="undo" onClick={reload} disabled={pendingCount === 0}>
          {pendingCount > 1 ? `Reload preview (${pendingCount} changes)` : "Reload preview"}
        </Button>
        <Button
          onClick={() => {
            setPending({});
            store.applyOverrides({});
          }}
          disabled={Object.keys(overrides).length === 0 && pendingCount === 0}
        >
          Reset to default
        </Button>
        <Button
          variant="tertiary"
          icon="target"
          onClick={() => {
            closeTool();
            setMode("select");
          }}
        >
          Select on page
        </Button>
      </div>

      {prefs.debug && (
        <section className={styles.memberDetail} aria-labelledby="routing-headers-title">
          <h3 id="routing-headers-title" className={styles.sectionTitle}>
            Routing headers
          </h3>
          <p className={styles.muted}>Simulated response headers for each member&apos;s last request.</p>
          {app.members.map((member) => (
            <dl key={member.id} className={styles.headers} aria-label={`Routing headers for ${member.name}`}>
              {routingHeaders(routing[member.id]!).map(([name, value]) => (
                <div key={name} className={styles.header}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ))}
        </section>
      )}

      <div className={styles.toggles}>
        <Checkbox id="zone-indicator" label="Zone indicator" description="Show which microfrontend serves the current route." checked={prefs.zoneIndicator} onChange={(event) => setToolbarPrefs({ zoneIndicator: event.currentTarget.checked })} />
        <Checkbox id="debug-mode" label="Enable debug mode" description="Label each region with how its routing was decided." checked={prefs.debug} onChange={(event) => setToolbarPrefs({ debug: event.currentTarget.checked })} />
      </div>
    </ToolPanel>
  );
}
