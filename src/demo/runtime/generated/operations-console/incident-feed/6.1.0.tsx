import { usePublish } from "@deweb/portal";
import { Button, Dropdown, FlexLayout, FormField, FormFieldLabel, GridLayout, H2, Option, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { type SyntheticEvent, useState } from "react";
import { type Incident, INCIDENTS, SEVERITIES, UPDATED } from "../data";
import styles from "./6.1.0.module.css";

const SEVERITY_OPTIONS = [{ value: "all", label: "All severities" }, ...SEVERITIES.map((severity) => ({ value: severity.value, label: `${severity.label} · ${severity.meaning}` }))];
const SEVERITY_STATUS = { SEV1: "error", SEV2: "warning", SEV3: "info" } as const;

export default function IncidentFeed() {
  const [severity, setSeverity] = useState<string>("all");
  const [selected, setSelected] = useState<string>(INCIDENTS[0]!.id);
  const publish = usePublish("incident-feed");
  const rows = INCIDENTS.filter((incident) => severity === "all" || incident.severity === severity);

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
            <FormFieldLabel>Severity</FormFieldLabel>
            <Dropdown
              data-demo-anchor="incident-filter"
              selected={[severity]}
              valueToString={(value: string) => SEVERITY_OPTIONS.find((option) => option.value === value)?.label ?? value}
              onSelectionChange={(_event: SyntheticEvent, next: string[]) => setSeverity(next[0] ?? "all")}
            >
              {SEVERITY_OPTIONS.map((option) => (
                <Option key={option.value} value={option.value}>
                  {option.label}
                </Option>
              ))}
            </Dropdown>
          </FormField>
        </GridLayout>
        {rows.length === 0 ? (
          <Text color="secondary">No open incidents have this severity. Choose All severities to see every open incident.</Text>
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
                {rows.map((incident) => {
                  const current = incident.id === selected;
                  return (
                    <TR key={incident.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`incident-${incident.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" aria-label={`Show health for ${incident.id}`} aria-pressed={current} onClick={() => choose(incident)} data-demo-anchor={`focus-${incident.id}`}>
                          {incident.id}
                        </Button>
                      </TD>
                      <TD>
                        <StackLayout gap={0}>
                          <Text>{incident.title}</Text>
                          <Text styleAs="label" color="secondary">
                            {current ? `${incident.service} · Selected` : incident.service}
                          </Text>
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
