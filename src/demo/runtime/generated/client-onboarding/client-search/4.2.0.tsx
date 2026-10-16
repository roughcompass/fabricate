import { useState } from "react";
import {
  FlexLayout,
  FlowLayout,
  FormField,
  FormFieldLabel,
  H2,
  Input,
  Panel,
  StackLayout,
  StatusIndicator,
  Text,
  ToggleButton,
} from "@salt-ds/core";
import { usePublish } from "@deweb/portal";
import { CLIENTS } from "../data";

const SEGMENTS = ["All", "Corporate", "Commercial", "Financial institution"];

export default function ClientSearch() {
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("All");
  const [selected, setSelected] = useState(CLIENTS[0]!.id);
  const publish = usePublish("client-search");
  const rows = CLIENTS.filter(
    (entry) =>
      entry.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (segment === "All" || entry.segment === segment),
  );

  return (
    <Panel data-demo-anchor="client-panel">
      <StackLayout gap={2}>
        <H2>Clients</H2>
        <FormField>
          <FormFieldLabel>Search clients</FormFieldLabel>
          <Input
            placeholder="Client name"
            value={query}
            onChange={(event) => setQuery((event.target as HTMLInputElement).value)}
            inputProps={{
              id: "client-query",
              type: "search",
              "data-demo-anchor": "client-search",
            }}
          />
        </FormField>
        <FlowLayout gap={1} role="group" aria-label="Segment">
          {SEGMENTS.map((option) => (
            <ToggleButton
              key={option}
              value={option}
              selected={segment === option}
              onChange={() => setSegment(option)}
              data-demo-anchor={`segment-${option}`}
            >
              {option}
            </ToggleButton>
          ))}
        </FlowLayout>
        <StackLayout
          as="ul"
          gap={1}
          aria-label="Recently viewed clients"
          style={{ listStyle: "none", padding: 0, margin: 0 }}
        >
          {rows.map((entry) => (
            <li key={entry.id} style={{ display: "grid" }}>
              <ToggleButton
                value={entry.id}
                selected={selected === entry.id}
                onChange={() => {
                  setSelected(entry.id);
                  publish("client:selected", { id: entry.id, name: entry.name });
                }}
                data-demo-anchor={`client-${entry.id}`}
                style={{
                  height: "auto",
                  justifyContent: "space-between",
                  padding: "var(--salt-spacing-100)",
                  gap: "var(--salt-spacing-200)",
                  textAlign: "left",
                }}
              >
                <StackLayout gap={0} align="start">
                  <Text styleAs="label">
                    <strong>{entry.name}</strong>
                  </Text>
                  <Text color="inherit">{`${entry.segment} · ${entry.country}`}</Text>
                </StackLayout>
                <FlexLayout gap={1} align="center">
                  <StatusIndicator status={entry.stage === "Approved" ? "success" : "info"} />
                  <Text>{entry.stage}</Text>
                </FlexLayout>
              </ToggleButton>
            </li>
          ))}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}
