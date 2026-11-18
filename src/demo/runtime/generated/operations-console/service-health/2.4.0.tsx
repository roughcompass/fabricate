import { useBus } from "@deweb/portal";
import { FlexLayout, H2, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Tag, Text } from "@salt-ds/core";
import { useState } from "react";
import { REGIONS, SERVICES, UPDATED } from "../data";
import styles from "./2.4.0.module.css";

type Health = "Healthy" | "Degraded" | "Outage";

const HEALTH_STATUS = { Healthy: "success", Degraded: "warning", Outage: "error" } as const;
const HEALTHS: readonly Health[] = ["Outage", "Degraded", "Healthy"];
const healthOf = (service: (typeof SERVICES)[number], region: (typeof REGIONS)[number]) => service.status[region] as Health;

export default function ServiceHealth() {
  const [focus, setFocus] = useState<string | null>(null);

  useBus("incident:selected", "service-health", (payload: unknown) => {
    const region = (payload as { region?: unknown } | null)?.region;
    if (typeof region === "string" && (REGIONS as readonly string[]).includes(region)) setFocus(region);
  });

  const counts = HEALTHS.map((health) => ({ health, count: SERVICES.reduce((total, service) => total + REGIONS.filter((region) => healthOf(service, region) === health).length, 0) }));

  return (
    <Panel data-demo-anchor="health-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Service health</H2>
          <Text styleAs="label" color="secondary">{`Updated ${UPDATED}`}</Text>
        </FlexLayout>
        <FlexLayout as="ul" gap={2} wrap aria-label="Health across every service and region" className={styles.list}>
          {counts.map(({ health, count }) => (
            <FlexLayout key={health} as="li" gap={1} align="center">
              <StatusIndicator status={HEALTH_STATUS[health]} />
              <Text className={styles.figure}>{`${count} ${health.toLowerCase()}`}</Text>
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
                  <TH key={region} className={focus === region ? styles.focus : undefined}>
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
                    const health = healthOf(service, region);
                    return (
                      <TD key={region} className={focus === region ? styles.focus : undefined}>
                        <FlexLayout gap={1} align="center" wrap={false}>
                          <StatusIndicator status={HEALTH_STATUS[health]} />
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
