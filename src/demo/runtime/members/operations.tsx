"use client";

import { useState } from "react";
import { useBusSubscription, useProfile, usePublish } from "../runtime-context";
import { Icon } from "./icons";
import { blockMainThread } from "./planted";
import { Badge, Button, Field, Muted, Panel, Select, Table, Td, Th, Tr, uiStyles } from "./ui";

/** The Operations console hero: incident feed, service health, and change calendar. */

interface Incident {
  id: string;
  title: string;
  severity: "SEV1" | "SEV2" | "SEV3";
  region: string;
  opened: string;
}

const INCIDENTS: readonly Incident[] = [
  { id: "INC-2041", title: "Elevated latency on payments gateway", severity: "SEV2", region: "EMEA", opened: "09:12" },
  { id: "INC-2042", title: "Login failures for a subset of users", severity: "SEV1", region: "Americas", opened: "09:40" },
  { id: "INC-2043", title: "Delayed report generation", severity: "SEV3", region: "APAC", opened: "10:05" },
  { id: "INC-2044", title: "Search index rebuild running long", severity: "SEV3", region: "EMEA", opened: "10:31" },
];

const SEVERITY_TONES = { SEV1: "negative", SEV2: "accent", SEV3: "neutral" } as const;

function useIncidents() {
  const [severity, setSeverity] = useState("all");
  const [selected, setSelected] = useState(INCIDENTS[0]!.id);
  const publish = usePublish("incident-feed");
  const rows = INCIDENTS.filter((incident) => severity === "all" || incident.severity === severity);
  const choose = (incident: Incident) => {
    setSelected(incident.id);
    publish("incident:selected", { id: incident.id, region: incident.region });
  };
  return { severity, setSeverity, selected, rows, choose };
}

/**
 * PLANTED DEFECTS (incident feed 6.0.0): the filter has no label, the
 * regions use the deliberately faint token, and the acknowledge buttons are
 * icons with no accessible name. Version 6.1.0 fixes all three.
 */
function IncidentFeed600() {
  const { selected, rows, choose } = useIncidents();
  const [text, setText] = useState("");
  const visible = rows.filter((incident) => `${incident.id} ${incident.title}`.toLowerCase().includes(text.trim().toLowerCase()));
  return (
    <Panel title="Incidents" anchor="incident-panel">
      <p className={uiStyles.muted}>Filter incidents</p>
      <input className={uiStyles.input} value={text} onChange={(event) => setText(event.currentTarget.value)} data-demo-anchor="incident-filter" />
      <Table label="Open incidents" head={<><Th>Incident</Th><Th>Severity</Th><Th>Region</Th><Th /></>}>
        {visible.map((incident) => (
          <Tr key={incident.id} selected={selected === incident.id} anchor={`incident-${incident.id}`}>
            <Td>{`${incident.id} · ${incident.title}`}</Td>
            <Td>
              <Badge tone={SEVERITY_TONES[incident.severity]}>{incident.severity}</Badge>
            </Td>
            <Td className={uiStyles.defectFaint}>{incident.region}</Td>
            <Td>
              <button type="button" className={[uiStyles.button, uiStyles.ghost].join(" ")} onClick={() => choose(incident)} data-demo-anchor={`focus-${incident.id}`}>
                <Icon name="alert" />
              </button>
            </Td>
          </Tr>
        ))}
      </Table>
    </Panel>
  );
}

function IncidentFeed({ timeline }: { timeline: boolean }) {
  const { severity, setSeverity, selected, rows, choose } = useIncidents();
  const ordered = timeline ? [...rows].sort((left, right) => left.severity.localeCompare(right.severity)) : rows;
  return (
    <Panel title="Incidents" anchor="incident-panel" actions={timeline ? <Badge tone="accent">Preview: grouped by severity</Badge> : undefined}>
      <Field id={timeline ? "incident-filter-timeline" : "incident-filter"} label="Severity">
        <Select id={timeline ? "incident-filter-timeline" : "incident-filter"} value={severity} onChange={(event) => setSeverity(event.currentTarget.value)} anchor="incident-filter">
          <option value="all">All severities</option>
          <option value="SEV1">SEV1</option>
          <option value="SEV2">SEV2</option>
          <option value="SEV3">SEV3</option>
        </Select>
      </Field>
      <Table label="Open incidents" head={<><Th>Incident</Th><Th>Severity</Th><Th>Region</Th><Th>Focus</Th></>}>
        {ordered.map((incident) => (
          <Tr key={incident.id} selected={selected === incident.id} anchor={`incident-${incident.id}`}>
            <Td>{`${incident.id} · ${incident.title}`}</Td>
            <Td>
              <Badge tone={SEVERITY_TONES[incident.severity]}>{incident.severity}</Badge>
            </Td>
            <Td>{incident.region}</Td>
            <Td>
              <Button variant="ghost" onClick={() => choose(incident)} anchor={`focus-${incident.id}`} aria-label={`Focus ${incident.id}, show its health`}>
                <Icon name="alert" />
                Focus
              </Button>
            </Td>
          </Tr>
        ))}
      </Table>
    </Panel>
  );
}

const REGIONS = ["Americas", "EMEA", "APAC"] as const;
const SERVICES = [
  { name: "Gateway", status: { Americas: "Healthy", EMEA: "Degraded", APAC: "Healthy" } },
  { name: "Identity", status: { Americas: "Outage", EMEA: "Healthy", APAC: "Healthy" } },
  { name: "Reporting", status: { Americas: "Healthy", EMEA: "Healthy", APAC: "Degraded" } },
  { name: "Search", status: { Americas: "Healthy", EMEA: "Degraded", APAC: "Healthy" } },
] as const;
const HEALTH_TONES = { Healthy: "positive", Degraded: "accent", Outage: "negative" } as const;

function ServiceHealth() {
  const [focus, setFocus] = useState<string | null>(null);
  useBusSubscription("incident:selected", "service-health", (payload) => {
    const region = (payload as { region?: unknown })?.region;
    if (typeof region === "string" && (REGIONS as readonly string[]).includes(region)) setFocus(region);
  });
  return (
    <Panel title="Service health" anchor="health-panel" actions={focus ? <Badge tone="accent">{`Focused on ${focus}`}</Badge> : undefined}>
      <Table label="Service health by region" head={<><Th>Service</Th>{REGIONS.map((region) => <Th key={region}>{region}</Th>)}</>}>
        {SERVICES.map((service) => (
          <Tr key={service.name} anchor={`service-${service.name}`}>
            <Td>{service.name}</Td>
            {REGIONS.map((region) => (
              <Td key={region} className={focus === region ? uiStyles.selected : undefined}>
                <Badge tone={HEALTH_TONES[service.status[region]]}>{service.status[region]}</Badge>
              </Td>
            ))}
          </Tr>
        ))}
      </Table>
    </Panel>
  );
}

const CHANGES = [
  { id: "CHG-731", title: "Rotate gateway certificates", window: "Tue 22:00", risk: "Low", status: "Scheduled" },
  { id: "CHG-732", title: "Upgrade identity provider", window: "Wed 21:00", risk: "High", status: "Awaiting approval" },
  { id: "CHG-733", title: "Resize reporting cluster", window: "Thu 20:00", risk: "Medium", status: "Awaiting approval" },
] as const;

function ChangeCalendar() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [checked, setChecked] = useState(false);
  return (
    <Panel
      title="Change calendar"
      anchor="changes-panel"
      actions={
        <Button
          onClick={() => {
            blockMainThread(650);
            setChecked(true);
          }}
          anchor="check-conflicts"
        >
          <Icon name="calendar" />
          Check for conflicts
        </Button>
      }
    >
      {checked && <Muted>No conflicting changes this week.</Muted>}
      <Table label="Changes this week" head={<><Th>Change</Th><Th>Window</Th><Th>Risk</Th><Th>Status</Th>{approver && <Th>Approval</Th>}</>}>
        {CHANGES.map((change) => {
          const status = approved.includes(change.id) ? "Approved" : change.status;
          return (
            <Tr key={change.id} anchor={`change-${change.id}`}>
              <Td>{`${change.id} · ${change.title}`}</Td>
              <Td>{change.window}</Td>
              <Td>{change.risk}</Td>
              <Td>
                <Badge tone={status === "Awaiting approval" ? "accent" : "positive"}>{status}</Badge>
              </Td>
              {approver && (
                <Td>
                  {status === "Awaiting approval" ? (
                    <Button variant="primary" onClick={() => setApproved((ids) => [...ids, change.id])} anchor={`approve-${change.id}`}>
                      {`Approve ${change.id}`}
                    </Button>
                  ) : (
                    <span className={uiStyles.muted}>None needed</span>
                  )}
                </Td>
              )}
            </Tr>
          );
        })}
      </Table>
      {!approver && <Muted>Changes are approved by the Approver role.</Muted>}
    </Panel>
  );
}

export const OPERATIONS_MEMBERS = {
  "incident-feed": { "6.0.0": IncidentFeed600, "6.1.0": () => <IncidentFeed timeline={false} />, "7.0.0-alpha.3": () => <IncidentFeed timeline /> },
  "service-health": { "2.4.0": ServiceHealth },
  "change-calendar": { "1.2.0": ChangeCalendar },
} as const;
