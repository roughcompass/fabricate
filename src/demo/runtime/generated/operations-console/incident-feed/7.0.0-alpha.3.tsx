import { usePublish } from "@deweb/portal";
import { Button, Dropdown, FlexLayout, FormField, FormFieldLabel, GridLayout, H2, H3, Option, Panel, StackLayout, StatusIndicator, Tag, Text } from "@salt-ds/core";
import { type SyntheticEvent, useId, useState } from "react";
import { type Incident, INCIDENTS, SEVERITIES, UPDATED } from "../data";
import styles from "./7.0.0-alpha.3.module.css";

const SEVERITY_OPTIONS = [{ value: "all", label: "All severities" }, ...SEVERITIES.map((severity) => ({ value: severity.value, label: `${severity.label} · ${severity.meaning}` }))];
const SEVERITY_STATUS = { SEV1: "error", SEV2: "warning", SEV3: "info" } as const;

export default function IncidentFeed() {
  const id = useId();
  const [severity, setSeverity] = useState<string>("all");
  const [selected, setSelected] = useState<string>(INCIDENTS[0]!.id);
  const publish = usePublish("incident-feed");
  // Each severity's incidents, oldest first, so each group reads as a timeline.
  const groups = SEVERITIES.filter((group) => severity === "all" || group.value === severity)
    .map((group) => ({ ...group, incidents: INCIDENTS.filter((incident) => incident.severity === group.value).sort((left, right) => left.opened.localeCompare(right.opened)) }))
    .filter((group) => group.incidents.length > 0);

  const choose = (incident: Incident) => {
    setSelected(incident.id);
    publish("incident:selected", { id: incident.id, name: incident.title, region: incident.region });
  };

  return (
    <Panel data-demo-anchor="incident-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={1} wrap>
          <H2>Incidents</H2>
          <Tag>Preview: grouped by severity</Tag>
        </FlexLayout>
        <Text styleAs="label" color="secondary">{`${INCIDENTS.length} open, updated ${UPDATED}`}</Text>
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
        {groups.length === 0 ? (
          <Text color="secondary">No open incidents have this severity. Choose All severities to see every open incident.</Text>
        ) : (
          groups.map((group) => (
            <StackLayout key={group.value} as="section" gap={1} aria-labelledby={`${id}-${group.value}`}>
              <FlexLayout gap={1} align="center">
                <StatusIndicator status={SEVERITY_STATUS[group.value]} />
                <H3 id={`${id}-${group.value}`}>{`${group.label} · ${group.meaning}`}</H3>
              </FlexLayout>
              <StackLayout as="ol" gap={1} className={styles.list}>
                {group.incidents.map((incident) => {
                  const current = incident.id === selected;
                  return (
                    <FlexLayout key={incident.id} as="li" justify="space-between" align="center" gap={2} wrap padding={1} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`incident-${incident.id}`}>
                      <StackLayout gap={0}>
                        <Text styleAs="label" color="secondary">{`${incident.opened} · ${incident.id} · ${incident.region} · ${incident.service}`}</Text>
                        <Text fontWeight="bolder">{incident.title}</Text>
                        {current && (
                          <Text styleAs="label" color="secondary">
                            Selected
                          </Text>
                        )}
                      </StackLayout>
                      <Button sentiment="neutral" appearance="bordered" aria-label={`Show health for ${incident.id}`} aria-pressed={current} onClick={() => choose(incident)} data-demo-anchor={`focus-${incident.id}`}>
                        Show health
                      </Button>
                    </FlexLayout>
                  );
                })}
              </StackLayout>
            </StackLayout>
          ))
        )}
      </StackLayout>
    </Panel>
  );
}
