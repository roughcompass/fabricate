// Operations console: the Incidents route as one page, composed from its microfrontends at their conformant versions:
// incident-feed 6.1.0 (main)
// service-health 2.4.0 (side)
// change-calendar 1.2.0 (wide)
import { planted, useBus, useProfile, usePublish } from "@deweb/portal";
import { Button, Dropdown, FlexLayout, FormField, FormFieldLabel, GridItem, GridLayout, H2, Option, Panel, StackLayout, StatusIndicator, Table, TableContainer, Tag, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { CalendarIcon, WarningIcon } from "@salt-ds/icons";
import { useState } from "react";
import { CHANGES, type Incident, INCIDENTS, REGIONS, SERVICES } from "./data";

const IncidentFeed_SEVERITY_OPTIONS = [
  { value: "all", label: "All severities" },
  { value: "SEV1", label: "SEV1" },
  { value: "SEV2", label: "SEV2" },
  { value: "SEV3", label: "SEV3" },
] as const;

const IncidentFeed_SEVERITY_STATUS = {
  SEV1: "error",
  SEV2: "warning",
  SEV3: "info",
} as const;

function IncidentFeed() {
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
              IncidentFeed_SEVERITY_OPTIONS.find((option) => option.value === value)?.label ?? value
            }
            onSelectionChange={(_event, newSelected: string[]) =>
              setSeverity(newSelected[0] ?? "all")
            }
          >
            {IncidentFeed_SEVERITY_OPTIONS.map((option) => (
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
                        <StatusIndicator status={IncidentFeed_SEVERITY_STATUS[incident.severity]} />
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
                        aria-label={`Focus ${incident.id}, show its health`}
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

type ServiceHealth_Health = "Healthy" | "Degraded" | "Outage";

const ServiceHealth_HEALTH_STATUS = {
  Healthy: "success",
  Degraded: "warning",
  Outage: "error",
} as const;

function ServiceHealth() {
  const [focus, setFocus] = useState<string | null>(null);

  useBus("incident:selected", "service-health", (payload: unknown) => {
    const region = (payload as { region?: unknown } | null)?.region;
    if (typeof region === "string" && (REGIONS as readonly string[]).includes(region)) {
      setFocus(region);
    }
  });

  return (
    <Panel data-demo-anchor="health-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={1} wrap>
          <H2 styleAs="h3">Service health</H2>
          {focus ? <Tag>{`Focused on ${focus}`}</Tag> : null}
        </FlexLayout>
        <TableContainer>
          <Table aria-label="Service health by region">
            <THead>
              <TR>
                <TH>Service</TH>
                {REGIONS.map((region) =>
                  focus === region ? (
                    <TH
                      key={region}
                      style={{ background: "var(--salt-selectable-background-selected)" }}
                    >
                      {region}
                    </TH>
                  ) : (
                    <TH key={region}>{region}</TH>
                  )
                )}
              </TR>
            </THead>
            <TBody>
              {SERVICES.map((service) => (
                <TR key={service.name} data-demo-anchor={`service-${service.name}`}>
                  <TD>
                    <Text>{service.name}</Text>
                  </TD>
                  {REGIONS.map((region) => {
                    const health = service.status[region] as ServiceHealth_Health;
                    const content = (
                      <FlexLayout gap={1} align="center" wrap={false}>
                        <StatusIndicator status={ServiceHealth_HEALTH_STATUS[health]} />
                        <Text>{health}</Text>
                      </FlexLayout>
                    );
                    return focus === region ? (
                      <TD
                        key={region}
                        style={{ background: "var(--salt-selectable-background-selected)" }}
                      >
                        {content}
                      </TD>
                    ) : (
                      <TD key={region}>{content}</TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </StackLayout>
    </Panel>
  );
}

function ChangeCalendar() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [checked, setChecked] = useState(false);

  return (
    <Panel data-demo-anchor="changes-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <H2>Change calendar</H2>
          <Button
            sentiment="neutral"
            appearance="bordered"
            onClick={() => {
              planted.blockMainThread(650);
              setChecked(true);
            }}
            data-demo-anchor="check-conflicts"
          >
            <CalendarIcon aria-hidden />
            Check for conflicts
          </Button>
        </FlexLayout>
        {checked && (
          <Text color="secondary" aria-live="polite">
            No conflicting changes this week.
          </Text>
        )}
        <TableContainer>
          <Table aria-label="Changes this week">
            <THead>
              <TR>
                <TH>Change</TH>
                <TH>Window</TH>
                <TH>Risk</TH>
                <TH>Status</TH>
                {approver && <TH>Approval</TH>}
              </TR>
            </THead>
            <TBody>
              {CHANGES.map((change) => {
                const status: string = approved.includes(change.id) ? "Approved" : change.status;
                const awaiting = status === "Awaiting approval";
                return (
                  <TR key={change.id} data-demo-anchor={`change-${change.id}`}>
                    <TD>{`${change.id} · ${change.title}`}</TD>
                    <TD>{change.window}</TD>
                    <TD>{change.risk}</TD>
                    <TD>
                      <FlexLayout gap={1} align="center">
                        <StatusIndicator status={awaiting ? "warning" : "success"} />
                        <Text>{status}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {awaiting ? (
                          <Button
                            sentiment="accented"
                            appearance="solid"
                            onClick={() => setApproved((ids) => [...ids, change.id])}
                            data-demo-anchor={`approve-${change.id}`}
                          >
                            {`Approve ${change.id}`}
                          </Button>
                        ) : (
                          <Text color="secondary">None needed</Text>
                        )}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>
        {!approver && <Text color="secondary">Changes are approved by the Approver role.</Text>}
      </StackLayout>
    </Panel>
  );
}

export default function OperationsConsole() {
  return (
    <GridLayout columns={3} gap={3}>
      <GridItem colSpan={2}>
        <IncidentFeed />
      </GridItem>
      <GridItem colSpan={1}>
        <ServiceHealth />
      </GridItem>
      <GridItem colSpan={3}>
        <ChangeCalendar />
      </GridItem>
    </GridLayout>
  );
}
