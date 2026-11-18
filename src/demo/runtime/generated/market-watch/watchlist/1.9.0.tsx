import { usePublish } from "@deweb/portal";
import { Button, FlexLayout, FormField, FormFieldLabel, H2, Input, Panel, StackLayout, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { FilterIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { type Instrument, INSTRUMENTS, UPDATED } from "../data";
import styles from "./1.9.0.module.css";

const signed = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
const tone = (change: number) => (change > 0 ? "success" : change < 0 ? "error" : "secondary");

export default function Watchlist() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(INSTRUMENTS[0]!.symbol);
  const publish = usePublish("watchlist");
  const query = filter.trim().toLowerCase();
  const rows = INSTRUMENTS.filter((entry) => `${entry.symbol} ${entry.name}`.toLowerCase().includes(query));

  const choose = (entry: Instrument) => {
    setSelected(entry.symbol);
    publish("instrument:selected", { symbol: entry.symbol, name: entry.name });
  };

  return (
    <Panel data-demo-anchor="watchlist-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>Watchlist</H2>
          <Text styleAs="label" color="secondary">{`Delayed 15 minutes, updated ${UPDATED}`}</Text>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Filter symbols</FormFieldLabel>
          <Input
            startAdornment={<FilterIcon aria-hidden />}
            placeholder="Symbol or name"
            value={filter}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setFilter(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "watchlist-filter" } as Record<string, string>}
          />
        </FormField>
        {rows.length === 0 ? (
          <Text color="secondary">{`No instruments match "${filter.trim()}". Clear the filter to see every instrument.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="Watchlist">
              <THead sticky>
                <TR>
                  <TH>Symbol</TH>
                  <TH textAlign="right">Last (USD)</TH>
                  <TH textAlign="right">Change</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((entry) => {
                  const current = entry.symbol === selected;
                  return (
                    <TR key={entry.symbol} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`instrument-${entry.symbol}`}>
                      <TD>
                        <StackLayout gap={0} align="start">
                          <Button sentiment="neutral" appearance="transparent" aria-label={`Chart ${entry.symbol}`} aria-pressed={current} onClick={() => choose(entry)} data-demo-anchor={`chart-${entry.symbol}`}>
                            {entry.symbol}
                          </Button>
                          <Text styleAs="label" color="secondary">
                            {entry.name}
                          </Text>
                        </StackLayout>
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {entry.price.toFixed(2)}
                      </TD>
                      <TD textAlign="right">
                        <Text color={tone(entry.change)} className={styles.figure}>
                          {signed(entry.change)}
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
