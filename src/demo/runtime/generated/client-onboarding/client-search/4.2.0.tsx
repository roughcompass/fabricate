import { usePublish } from "@deweb/portal";
import { Button, FlexLayout, FlowLayout, FormField, FormFieldLabel, H2, H3, Input, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text, ToggleButton } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { CLIENTS, type Client } from "../data";
import styles from "./4.2.0.module.css";

const SEGMENTS = ["All", "Corporate", "Commercial", "Financial institution"];

const tone = (stage: string) => (stage === "Approved" ? "success" : "info");

export default function ClientSearch() {
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("All");
  const [selected, setSelected] = useState(CLIENTS[0]!.id);
  const publish = usePublish("client-search");
  const search = query.trim().toLowerCase();
  const rows = CLIENTS.filter((client) => client.name.toLowerCase().includes(search) && (segment === "All" || client.segment === segment));

  const choose = (client: Client) => {
    setSelected(client.id);
    publish("client:selected", { id: client.id, name: client.name });
  };

  const empty = search
    ? `No ${segment === "All" ? "" : `${segment} `}clients match "${query.trim()}". Clear the search${segment === "All" ? "" : " or choose All"} to see more clients.`
    : `No clients are in the ${segment} segment. Choose All to see every client.`;

  return (
    <Panel data-demo-anchor="client-panel">
      <StackLayout gap={2}>
        <H2>Clients</H2>
        <FormField>
          <FormFieldLabel>Search clients</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Client name"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "client-search" }}
          />
        </FormField>
        <StackLayout gap={1}>
          <Text id="client-segment" styleAs="label" color="secondary">
            Segment
          </Text>
          <FlowLayout gap={1} role="group" aria-labelledby="client-segment">
            {SEGMENTS.map((option) => (
              <ToggleButton key={option} value={option} selected={segment === option} onChange={() => setSegment(option)} data-demo-anchor={`segment-${option}`}>
                {option}
              </ToggleButton>
            ))}
          </FlowLayout>
        </StackLayout>
        <StackLayout gap={1}>
          <H3 id="recent-clients">Recently viewed clients</H3>
          {rows.length === 0 ? (
            <Text color="secondary">{empty}</Text>
          ) : (
            <TableContainer>
              <Table aria-labelledby="recent-clients">
                <THead sticky>
                  <TR>
                    <TH>Client</TH>
                    <TH>Segment</TH>
                    <TH>Country</TH>
                    <TH>Stage</TH>
                    <TH>Last viewed</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((client) => {
                    const current = client.id === selected;
                    return (
                      <TR key={client.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined}>
                        <TD>
                          <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(client)} data-demo-anchor={`client-${client.id}`}>
                            {client.name}
                          </Button>
                        </TD>
                        <TD>{client.segment}</TD>
                        <TD>{client.country}</TD>
                        <TD>
                          <FlexLayout gap={1} align="center">
                            <StatusIndicator status={tone(client.stage)} aria-hidden />
                            <Text>{client.stage}</Text>
                          </FlexLayout>
                        </TD>
                        <TD>
                          <Text styleAs="label" color="secondary">
                            {client.viewed}
                          </Text>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableContainer>
          )}
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}
