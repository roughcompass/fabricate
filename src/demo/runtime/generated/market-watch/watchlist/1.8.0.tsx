import { usePublish } from "@deweb/portal";
import { Button, FlexLayout, H2, Panel, StackLayout, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { ChartLineIcon } from "@salt-ds/icons";
import { useState } from "react";
import { type Instrument, INSTRUMENTS, UPDATED } from "../data";
import styles from "./1.8.0.module.css";

const signed = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
const tone = (change: number) => (change > 0 ? "success" : change < 0 ? "error" : "secondary");

export default function Watchlist() {
  const [selected, setSelected] = useState(INSTRUMENTS[0]!.symbol);
  const publish = usePublish("watchlist");

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
        <TableContainer>
          <Table aria-label="Watchlist">
            <THead sticky>
              <TR>
                <TH>Symbol</TH>
                <TH>Name</TH>
                <TH textAlign="right">Last (USD)</TH>
                <TH textAlign="right">Change</TH>
              </TR>
            </THead>
            <TBody>
              {INSTRUMENTS.map((entry) => {
                const current = entry.symbol === selected;
                return (
                  <TR key={entry.symbol} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`instrument-${entry.symbol}`}>
                    <TD>
                      <FlexLayout gap={1} align="center" wrap={false}>
                        <Button sentiment="neutral" appearance="transparent" aria-label={`Chart ${entry.symbol}`} aria-pressed={current} onClick={() => choose(entry)} data-demo-anchor={`chart-${entry.symbol}`}>
                          <ChartLineIcon aria-hidden />
                        </Button>
                        <Text fontWeight="bolder">{entry.symbol}</Text>
                      </FlexLayout>
                    </TD>
                    <TD>
                      <Text color="secondary">{entry.name}</Text>
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
      </StackLayout>
    </Panel>
  );
}
