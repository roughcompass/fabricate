// Operations console: the Incidents route as one page, composed from its microfrontends at their conformant versions:
// incident-feed 6.1.0 (main)
// service-health 2.4.0 (side)
// change-calendar 1.2.0 (wide)
import { useBus, useProfile, usePublish } from "@deweb/portal";
import { Button, Dropdown, FlexLayout, FormField, FormFieldLabel, GridItem, GridLayout, H2, Option, Panel, StackLayout, StatusIndicator, Table, TableContainer, Tag, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { CalendarIcon } from "@salt-ds/icons";
import { type SyntheticEvent, useState } from "react";
import { CHANGES, type Incident, INCIDENTS, REGIONS, SERVICES, SEVERITIES, UPDATED, WEEK } from "./data";
import styles from "./page.module.css";

const IncidentFeed_SEVERITY_OPTIONS = [{ value: "all", label: "All severities" }, ...SEVERITIES.map((severity) => ({ value: severity.value, label: `${severity.label} · ${severity.meaning}` }))];

const IncidentFeed_SEVERITY_STATUS = { SEV1: "error", SEV2: "warning", SEV3: "info" } as const;

function IncidentFeed() {
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
              valueToString={(value: string) => IncidentFeed_SEVERITY_OPTIONS.find((option) => option.value === value)?.label ?? value}
              onSelectionChange={(_event: SyntheticEvent, next: string[]) => setSeverity(next[0] ?? "all")}
            >
              {IncidentFeed_SEVERITY_OPTIONS.map((option) => (
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
                    <TR key={incident.id} aria-current={current ? "true" : undefined} className={current ? styles["IncidentFeed_selected"] : undefined} data-demo-anchor={`incident-${incident.id}`}>
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
                          <StatusIndicator status={IncidentFeed_SEVERITY_STATUS[incident.severity]} />
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

type ServiceHealth_Health = "Healthy" | "Degraded" | "Outage";

const ServiceHealth_HEALTH_STATUS = { Healthy: "success", Degraded: "warning", Outage: "error" } as const;

const ServiceHealth_HEALTHS: readonly ServiceHealth_Health[] = ["Outage", "Degraded", "Healthy"];

const ServiceHealth_healthOf = (service: (typeof SERVICES)[number], region: (typeof REGIONS)[number]) => service.status[region] as ServiceHealth_Health;

function ServiceHealth() {
  const [focus, setFocus] = useState<string | null>(null);

  useBus("incident:selected", "service-health", (payload: unknown) => {
    const region = (payload as { region?: unknown } | null)?.region;
    if (typeof region === "string" && (REGIONS as readonly string[]).includes(region)) setFocus(region);
  });

  const counts = ServiceHealth_HEALTHS.map((health) => ({ health, count: SERVICES.reduce((total, service) => total + REGIONS.filter((region) => ServiceHealth_healthOf(service, region) === health).length, 0) }));

  return (
    <Panel data-demo-anchor="health-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Service health</H2>
          <Text styleAs="label" color="secondary">{`Updated ${UPDATED}`}</Text>
        </FlexLayout>
        <FlexLayout as="ul" gap={2} wrap aria-label="Health across every service and region" className={styles["ServiceHealth_list"]}>
          {counts.map(({ health, count }) => (
            <FlexLayout key={health} as="li" gap={1} align="center">
              <StatusIndicator status={ServiceHealth_HEALTH_STATUS[health]} />
              <Text className={styles["ServiceHealth_figure"]}>{`${count} ${health.toLowerCase()}`}</Text>
            </FlexLayout>
          ))}
        </FlexLayout>
        {focus ? (
          <FlexLayout>
            <Tag>{`Focused on ${focus}`}</Tag>
          </FlexLayout>
        ) : (
          <Text color="secondary">Choose an incident to focus on its region.</Text>
        )}
        <TableContainer>
          <Table aria-label="Service health by region">
            <THead sticky>
              <TR>
                <TH>Service</TH>
                {REGIONS.map((region) => (
                  <TH key={region} className={focus === region ? styles["ServiceHealth_focus"] : undefined}>
                    {region}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {SERVICES.map((service) => (
                <TR key={service.name} data-demo-anchor={`service-${service.name}`}>
                  <TD>
                    <Text fontWeight="bolder">{service.name}</Text>
                  </TD>
                  {REGIONS.map((region) => {
                    const health = ServiceHealth_healthOf(service, region);
                    return (
                      <TD key={region} className={focus === region ? styles["ServiceHealth_focus"] : undefined}>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={ServiceHealth_HEALTH_STATUS[health]} />
                          <Text>{health}</Text>
                        </FlexLayout>
                      </TD>
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

const ChangeCalendar_AWAITING = "Awaiting approval";

function ChangeCalendar() {
  const approver = useProfile().persona === "Approver";
  const [approved, setApproved] = useState<readonly string[]>([]);
  const [checked, setChecked] = useState(false);

  return (
    <Panel data-demo-anchor="changes-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <StackLayout gap={1}>
            <H2>Change calendar</H2>
            <Text styleAs="label" color="secondary" role="status">
              {checked ? `Week of ${WEEK}. No conflicting changes this week.` : `Week of ${WEEK}`}
            </Text>
          </StackLayout>
          <Button sentiment="neutral" appearance="bordered" onClick={() => setChecked(true)} data-demo-anchor="check-conflicts">
            <CalendarIcon aria-hidden />
            Check for conflicts
          </Button>
        </FlexLayout>
        <TableContainer>
          <Table aria-label="Changes this week">
            <THead sticky>
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
                const awaiting = status === ChangeCalendar_AWAITING;
                return (
                  <TR key={change.id} data-demo-anchor={`change-${change.id}`}>
                    <TD>
                      <StackLayout gap={0}>
                        <Text>{`${change.id} · ${change.title}`}</Text>
                        <Text styleAs="label" color="secondary">
                          {change.owner}
                        </Text>
                      </StackLayout>
                    </TD>
                    <TD>{change.window}</TD>
                    <TD>{change.risk}</TD>
                    <TD>
                      <FlexLayout gap={1} align="center" wrap={false}>
                        <StatusIndicator status={awaiting ? "warning" : "success"} />
                        <Text>{status}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {awaiting ? (
                          <Button sentiment="accented" appearance="transparent" onClick={() => setApproved((ids) => [...ids, change.id])} data-demo-anchor={`approve-${change.id}`}>
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
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <IncidentFeed />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <ServiceHealth />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 3 }}>
        <ChangeCalendar />
      </GridItem>
    </GridLayout>
  );
}
