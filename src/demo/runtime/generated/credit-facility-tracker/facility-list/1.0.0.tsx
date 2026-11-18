import { usePublish } from "@deweb/portal";
import { Button, FlexLayout, FormField, FormFieldLabel, H2, Input, Panel, StackLayout, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { AS_OF, FACILITIES, type Facility } from "../data";
import styles from "./1.0.0.module.css";

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const utilization = (facility: Facility) => `${((facility.drawn / facility.limit) * 100).toFixed(1)}%`;

export default function FacilityList() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(FACILITIES[0]!.id);
  const publish = usePublish("facility-list");
  const search = query.trim().toLowerCase();
  const rows = FACILITIES.filter((facility) => facility.borrower.toLowerCase().includes(search) || facility.type.toLowerCase().includes(search));

  const choose = (facility: Facility) => {
    setSelected(facility.id);
    publish("facility:selected", { id: facility.id, name: facility.borrower });
  };

  return (
    <Panel data-demo-anchor="facility-list-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Credit facilities</H2>
          <Text styleAs="label" color="secondary">{`Balances as of ${AS_OF}`}</Text>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Find a facility</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="Borrower or facility type"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "facility-search" }}
          />
        </FormField>
        {rows.length === 0 ? (
          <Text color="secondary">{`No facilities match "${query.trim()}". Clear the search to see every facility.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Credit facilities">
              <THead sticky>
                <TR>
                  <TH>Borrower</TH>
                  <TH textAlign="right">Limit</TH>
                  <TH textAlign="right">Drawn</TH>
                  <TH textAlign="right">Utilization</TH>
                  <TH>Maturity</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((facility) => {
                  const current = facility.id === selected;
                  return (
                    <TR key={facility.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`facility-${facility.id}`}>
                      <TD>
                        <StackLayout gap={1} align="start">
                          <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(facility)}>
                            {facility.borrower}
                          </Button>
                          <Text styleAs="label" color="secondary">
                            {facility.type}
                          </Text>
                        </StackLayout>
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {money(facility.currency, facility.limit)}
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {money(facility.currency, facility.drawn)}
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {utilization(facility)}
                      </TD>
                      <TD>{facility.maturity}</TD>
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
