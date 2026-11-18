import { usePublish } from "@deweb/portal";
import { Button, FlexLayout, FormField, FormFieldLabel, H2, Input, LinearProgress, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { DESKS, type Desk, type LimitStatus, UPDATED, WARNING_AT } from "../data";
import styles from "./1.0.0.module.css";

const STATUS = {
  within: { indicator: "success", label: "Within" },
  warning: { indicator: "warning", label: "Warning" },
  breach: { indicator: "error", label: "Breach" },
} as const;

const amount = (value: number) => value.toLocaleString("en-US");
const used = (desk: Desk) => Math.round((desk.usage / desk.limit) * 100);
const statusOf = (desk: Desk): LimitStatus => (desk.usage > desk.limit ? "breach" : used(desk) >= WARNING_AT ? "warning" : "within");

export default function DeskLimits() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(DESKS[0]!.id);
  const publish = usePublish("desk-limits");
  const search = query.trim().toLowerCase();
  const rows = DESKS.filter((desk) => desk.name.toLowerCase().includes(search) || desk.measure.toLowerCase().includes(search));

  const choose = (desk: Desk) => {
    setSelected(desk.id);
    publish("desk:selected", { id: desk.id, name: desk.name });
  };

  return (
    <Panel data-demo-anchor="desk-limits-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Desk limits</H2>
          <Text styleAs="label" color="secondary">{`USD thousands, updated ${UPDATED}`}</Text>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Find a desk</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Desk or measure"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "desk-search" }}
          />
        </FormField>
        {rows.length === 0 ? (
          <Text color="secondary">{`No desks match "${query.trim()}". Clear the search to see every desk.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Desk limits">
              <THead sticky>
                <TR>
                  <TH>Desk</TH>
                  <TH>Measure</TH>
                  <TH textAlign="right">Limit</TH>
                  <TH textAlign="right">Usage</TH>
                  <TH textAlign="right">Headroom</TH>
                  <TH>Used</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((desk) => {
                  const current = desk.id === selected;
                  const status = STATUS[statusOf(desk)];
                  const headroom = desk.limit - desk.usage;
                  return (
                    <TR key={desk.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`desk-${desk.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(desk)}>
                          {desk.name}
                        </Button>
                      </TD>
                      <TD>{desk.measure}</TD>
                      <TD textAlign="right" className={styles.figure}>
                        {amount(desk.limit)}
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {amount(desk.usage)}
                      </TD>
                      <TD textAlign="right">
                        <Text color={headroom < 0 ? "error" : "primary"} className={styles.figure}>
                          {amount(headroom)}
                        </Text>
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <LinearProgress className={styles.meter} value={Math.min(used(desk), 100)} hideLabel aria-label={`${desk.name} has used ${used(desk)}% of its limit`} />
                          <Text styleAs="label" color="secondary" className={styles.figure}>{`${used(desk)}%`}</Text>
                        </StackLayout>
                      </TD>
                      <TD>
                        <FlexLayout gap={1} align="center">
                          <StatusIndicator status={status.indicator} />
                          <Text>{status.label}</Text>
                        </FlexLayout>
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
