import { useState } from "react";
import {
  Button,
  Dropdown,
  FormField,
  FormFieldLabel,
  H2,
  Option,
  Panel,
  StackLayout,
  StatusIndicator,
  Table,
  TableContainer,
  TBody,
  TD,
  Text,
  TH,
  THead,
  TR,
} from "@salt-ds/core";
import { WarningIcon } from "@salt-ds/icons";
import { usePublish } from "@deweb/portal";
import { INCIDENTS, type Incident } from "../data";

const SEVERITY_OPTIONS = [
  { value: "all", label: "All severities" },
  { value: "SEV1", label: "SEV1" },
  { value: "SEV2", label: "SEV2" },
  { value: "SEV3", label: "SEV3" },
] as const;

const SEVERITY_STATUS = {
  SEV1: "error",
  SEV2: "warning",
  SEV3: "info",
} as const;

export default function IncidentFeed() {
  const [severity, setSeverity] = useState<string>("all");
  const [selected, setSelected] = useState<string>(INCIDENTS[0]!.id);
  const publish = usePublish("incident-feed");

  const rows = INCIDENTS.filter(
    (incident) => severity === "all" || incident.severity === severity,
  );

  const choose = (incident: Incident) => {
    setSelected(incident.id);
    publish("incident:selected", {
      id: incident.id,
      name: incident.title,
      region: incident.region,
    });
  };

  return (
    <Panel data-demo-anchor="incident-panel">
      <StackLayout gap={2}>
        <H2>Incidents</H2>
        <FormField style={{ maxWidth: "calc(var(--salt-size-base) * 8)" }}>
          <FormFieldLabel>Severity</FormFieldLabel>
          <Dropdown
            data-demo-anchor="incident-filter"
            selected={[severity]}
            valueToString={(value: string) =>
              SEVERITY_OPTIONS.find((option) => option.value === value)?.label ?? value
            }
            onSelectionChange={(_event, newSelected: string[]) =>
              setSeverity(newSelected[0] ?? "all")
            }
          >
            {SEVERITY_OPTIONS.map((option) => (
              <Option key={option.value} value={option.value}>
                {option.label}
              </Option>
            ))}
          </Dropdown>
        </FormField>
        <TableContainer>
          <Table>
            <caption>Open incidents</caption>
            <THead>
              <TR>
                <TH>Incident</TH>
                <TH>Severity</TH>
                <TH>Region</TH>
                <TH>Focus</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((incident) => {
                const isSelected = selected === incident.id;
                return (
                  <TR key={incident.id} data-demo-anchor={`incident-${incident.id}`}>
                    <TD>
                      <StackLayout gap={0}>
                        <Text>{`${incident.id} · ${incident.title}`}</Text>
                        {isSelected && (
                          <Text styleAs="label" color="secondary">
                            Selected
                          </Text>
                        )}
                      </StackLayout>
                    </TD>
                    <TD>
                      <StackLayout direction="row" gap={1} align="center">
                        <StatusIndicator status={SEVERITY_STATUS[incident.severity]} />
                        <Text>{incident.severity}</Text>
                      </StackLayout>
                    </TD>
                    <TD>
                      <Text>{incident.region}</Text>
                    </TD>
                    <TD>
                      <Button
                        appearance={isSelected ? "solid" : "transparent"}
                        sentiment={isSelected ? "accented" : "neutral"}
                        onClick={() => choose(incident)}
                        data-demo-anchor={`focus-${incident.id}`}
                        aria-label={`Show health for ${incident.id}`}
                      >
                        <WarningIcon aria-hidden />
                        Focus
                      </Button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
      </StackLayout>
    </Panel>
  );
}
