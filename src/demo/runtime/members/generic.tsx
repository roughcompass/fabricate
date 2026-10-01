"use client";

import { useState } from "react";
import { useBusSubscription, usePublish, useRuntime } from "../runtime-context";
import { Badge, Muted, Panel, Stat, Table, Td, Th, Tr, uiStyles } from "./ui";

/** The shared application behind every non-hero template: an overview and an activity feed. */

/** Deterministic sample records for a template, so every visit shows the same data. */
function records(slug: string) {
  const words = ["Alpha", "Beacon", "Cedar", "Delta", "Ember", "Falcon", "Granite", "Harbor"];
  const offset = [...slug].reduce((total, char) => total + char.charCodeAt(0), 0);
  return Array.from({ length: 5 }, (_, index) => {
    const word = words[(offset + index * 3) % words.length]!;
    return { id: `${slug.slice(0, 3).toUpperCase()}-${100 + ((offset + index * 17) % 900)}`, name: `${word} ${["review", "request", "batch", "update", "item"][index]}`, owner: ["Jordan Lee", "Sam Rivera", "Alex Morgan"][index % 3]!, status: index % 3 === 0 ? "Complete" : index % 3 === 1 ? "In progress" : "Open" };
  });
}

function Overview({ trends }: { trends: boolean }) {
  const { template } = useRuntime();
  const rows = records(template.slug);
  const [selected, setSelected] = useState<string | null>(null);
  const publish = usePublish("overview");
  return (
    <Panel title={template.title} anchor="overview-panel">
      <Muted>{template.description}</Muted>
      <div className={uiStyles.stats}>
        <Stat label="Open" value={`${rows.filter((row) => row.status === "Open").length}`} />
        <Stat label="In progress" value={`${rows.filter((row) => row.status === "In progress").length}`} />
        <Stat label="Complete" value={`${rows.filter((row) => row.status === "Complete").length}`} />
        {trends && <Stat label="This week" value="+12%" detail="Compared with last week" tone="positive" />}
      </div>
      <Table label={`${template.title} records`} head={<><Th>Record</Th><Th>Name</Th><Th>Owner</Th><Th>Status</Th></>}>
        {rows.map((row) => (
          <Tr key={row.id} selected={selected === row.id} anchor={`record-${row.id}`}>
            <Td>
              <button
                type="button"
                className={uiStyles.rowButton}
                onClick={() => {
                  setSelected(row.id);
                  publish("record:selected", { id: row.id, name: row.name });
                }}
              >
                {row.id}
              </button>
            </Td>
            <Td>{row.name}</Td>
            <Td>{row.owner}</Td>
            <Td>
              <Badge tone={row.status === "Complete" ? "positive" : row.status === "In progress" ? "accent" : "neutral"}>{row.status}</Badge>
            </Td>
          </Tr>
        ))}
      </Table>
    </Panel>
  );
}

function ActivityFeed() {
  const [events, setEvents] = useState<readonly string[]>(["Workspace created from the template", "Sample data loaded"]);
  useBusSubscription("record:selected", "activity", (payload) => {
    const name = (payload as { name?: unknown })?.name;
    if (typeof name === "string") setEvents((list) => [`Opened ${name}`, ...list].slice(0, 6));
  });
  return (
    <Panel title="Activity" anchor="activity-feed">
      <ul className={uiStyles.list}>
        {events.map((event, index) => (
          <li key={`${event}-${index}`} className={uiStyles.listItem}>
            {event}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export const GENERIC_MEMBERS = {
  overview: { "1.0.0": () => <Overview trends={false} />, "1.1.0": () => <Overview trends /> },
  activity: { "1.0.0": ActivityFeed },
} as const;
