import { useState } from "react";
import {
  Button,
  H2,
  Input,
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

const SEVERITY_STATUS = {
  SEV1: "error",
  SEV2: "warning",
  SEV3: "info",
} as const;

export default function IncidentFeed() {
  const [selected, setSelected] = useState<string>(INCIDENTS[0]!.id);
  const [text, setText] = useState("");
  const publish = usePublish("incident-feed");

  const query = text.trim().toLowerCase();
  const visible = INCIDENTS.filter((incident) =>
    `${incident.id} ${incident.title}`.toLowerCase().includes(query),
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
        <StackLayout gap={1}>
          <Text color="secondary">Filter incidents</Text>
          <Input
            data-demo-anchor="incident-filter"
            value={text}
            onChange={(event) => setText((event.target as HTMLInputElement).value)}
            style={{ maxWidth: "calc(var(--salt-size-base) * 10)" }}
          />
        </StackLayout>
        <TableContainer>
          <Table>
            <caption>Open incidents</caption>
            <THead>
              <TR>
                <TH>Incident</TH>
                <TH>Severity</TH>
                <TH>Region</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {visible.map((incident) => {
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
                      <Text style={{ color: "#b0b0b0" }}>{incident.region}</Text>
                    </TD>
                    <TD>
                      <Button
                        appearance={isSelected ? "solid" : "transparent"}
                        sentiment={isSelected ? "accented" : "neutral"}
                        onClick={() => choose(incident)}
                        data-demo-anchor={`focus-${incident.id}`}
                      >
                        <WarningIcon aria-hidden />
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
