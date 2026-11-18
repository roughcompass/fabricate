import { usePublish } from "@deweb/portal";
import { Button, Display3, FlexLayout, FormField, FormFieldLabel, GridLayout, H2, H3, Input, LinearProgress, Panel, StackLayout, StatusIndicator, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { AS_OF, FACILITIES, type Facility } from "../data";
import styles from "./1.1.0.module.css";

const money = (currency: string, value: number) => `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const utilization = (facility: Facility) => `${((facility.drawn / facility.limit) * 100).toFixed(1)}%`;
/** Portfolio totals read in millions, such as USD 675.0m. */
const millions = (currency: string, value: number) => `${currency} ${(value / 1000000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}m`;
const COMMITTED = FACILITIES.reduce((total, facility) => total + facility.limit, 0);
const DRAWN = FACILITIES.reduce((total, facility) => total + facility.drawn, 0);
const PORTFOLIO = Math.round((DRAWN / COMMITTED) * 100);
/** Facilities drawn to 90% or more of their limit. */
const NEAR_LIMIT = FACILITIES.filter((facility) => facility.drawn / facility.limit >= 0.9).length;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display3 className={styles.figure}>{value}</Display3>
    </StackLayout>
  );
}

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
        <StackLayout gap={2} as="section" aria-labelledby="facility-list-portfolio">
          <H3 id="facility-list-portfolio">{`Portfolio, ${FACILITIES.length} facilities`}</H3>
          <GridLayout columns={{ xs: 1, sm: 3 }} gap={2}>
            <Figure label="Committed" value={millions("USD", COMMITTED)} />
            <Figure label="Drawn" value={millions("USD", DRAWN)} />
            <Figure label="Available" value={millions("USD", COMMITTED - DRAWN)} />
          </GridLayout>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              Portfolio utilization
            </Text>
            <LinearProgress className={styles.meter} value={PORTFOLIO} aria-label={`Portfolio utilization, ${PORTFOLIO}% drawn`} />
          </StackLayout>
          <FlexLayout gap={1} align="center">
            <StatusIndicator status={NEAR_LIMIT > 0 ? "warning" : "success"} />
            <Text>{NEAR_LIMIT > 0 ? `${NEAR_LIMIT} ${NEAR_LIMIT === 1 ? "facility is" : "facilities are"} 90% or more drawn` : "No facility is 90% or more drawn"}</Text>
          </FlexLayout>
        </StackLayout>
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
