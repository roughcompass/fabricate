import { useState } from "react";
import {
  FlexLayout,
  H2,
  Panel,
  StackLayout,
  StatusIndicator,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tag,
  Text,
} from "@salt-ds/core";
import { useBus } from "@deweb/portal";
import { REGIONS, SERVICES } from "../data";

type Health = "Healthy" | "Degraded" | "Outage";

const HEALTH_STATUS = {
  Healthy: "success",
  Degraded: "warning",
  Outage: "error",
} as const;

export default function ServiceHealth() {
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
                    const health = service.status[region] as Health;
                    const content = (
                      <FlexLayout gap={1} align="center" wrap={false}>
                        <StatusIndicator status={HEALTH_STATUS[health]} />
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
