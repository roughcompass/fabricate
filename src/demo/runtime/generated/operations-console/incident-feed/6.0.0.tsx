import { usePublish } from "@deweb/portal";
import { Button, FlexLayout, FormField, FormFieldLabel, GridLayout, H2, Input, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon, TargetIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { type Incident, INCIDENTS, UPDATED } from "../data";
import styles from "./6.0.0.module.css";

const SEVERITY_STATUS = { SEV1: "error", SEV2: "warning", SEV3: "info" } as const;

export default function IncidentFeed() {
  const [selected, setSelected] = useState<string>(INCIDENTS[0]!.id);
  const [text, setText] = useState("");
  const publish = usePublish("incident-feed");
  const query = text.trim().toLowerCase();
  const visible = INCIDENTS.filter((incident) => `${incident.id} ${incident.title}`.toLowerCase().includes(query));

  const choose = (incident: Incident) => {
    setSelected(incident.id);
    publish("incident:selected", { id: incident.id, name: incident.title, region: incident.region });
  };

  return (
    <Panel data-demo-anchor="incident-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Incidents</H2>
          <Text styleAs="label" color="secondary">{`${INCIDENTS.length} open, updated ${UPDATED}`}</Text>
        </FlexLayout>
        <GridLayout columns={{ xs: 1, md: 2 }} gap={2}>
          <FormField>
            <FormFieldLabel>Filter incidents</FormFieldLabel>
            <Input
              data-demo-anchor="incident-filter"
              startAdornment={<SearchIcon aria-hidden />}
              placeholder="ID or title"
              value={text}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)}
              inputProps={{ type: "search" }}
            />
          </FormField>
        </GridLayout>
        {visible.length === 0 ? (
          <Text color="secondary">{`No incidents match "${text.trim()}". Clear the filter to see every open incident.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Open incidents">
              <THead sticky>
                <TR>
                  <TH>Incident</TH>
                  <TH>Title</TH>
                  <TH>Severity</TH>
                  <TH>Region</TH>
                  <TH>Opened</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((incident) => {
                  const current = incident.id === selected;
                  return (
                    <TR key={incident.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`incident-${incident.id}`}>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <Button sentiment="neutral" appearance="transparent" aria-label={`Show health for ${incident.id}`} aria-pressed={current} onClick={() => choose(incident)} data-demo-anchor={`focus-${incident.id}`}>
                            <TargetIcon aria-hidden />
                          </Button>
                          <Text fontWeight="bolder">{incident.id}</Text>
                        </FlexLayout>
                      </TD>
                      <TD>
                        <StackLayout gap={0}>
                          <Text>{incident.title}</Text>
                          {current && (
                            <Text styleAs="label" color="secondary">
                              Selected
                            </Text>
                          )}
                        </StackLayout>
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={SEVERITY_STATUS[incident.severity]} />
                          <Text>{incident.severity}</Text>
                        </FlexLayout>
                      </TD>
                      <TD>{incident.region}</TD>
                      <TD>
                        <Text styleAs="label" color="secondary">
                          {incident.opened}
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
    </Panel>
  );
}
