import { useBus } from "@deweb/portal";
import { Display4, GridLayout, H2, H3, Panel, StackLayout, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { useState } from "react";
import { type FxPair, PAIRS, QUOTES } from "../data";
import styles from "./1.0.0.module.css";

const price = (pair: FxPair, value: number) => value.toFixed(pair.decimals);
const tone = (pips: number) => (pips > 0 ? "success" : pips < 0 ? "error" : "secondary");

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles.figure}>{value}</Text>
    </StackLayout>
  );
}

export default function RateDetail() {
  const [id, setId] = useState(PAIRS[0]!.id);
  useBus("pair:selected", "rate-detail", (payload: unknown) => {
    const next = (payload as { id?: unknown } | null)?.id;
    if (typeof next === "string" && PAIRS.some((pair) => pair.id === next)) setId(next);
  });
  const pair = PAIRS.find((entry) => entry.id === id)!;
  const mid = (pair.bid + pair.ask) / 2;
  const quotes = QUOTES[pair.id] ?? [];

  return (
    <Panel data-demo-anchor="rate-detail-panel">
      <StackLayout gap={2}>
        <StackLayout gap={1}>
          <H2>{pair.pair}</H2>
          <Text color="secondary">{pair.name}</Text>
        </StackLayout>
        <StackLayout gap={1}>
          <Text styleAs="label" color="secondary">
            Mid rate
          </Text>
          <Display4 className={styles.figure}>{price(pair, mid)}</Display4>
          <Text color={tone(pair.change)}>{`${pair.change > 0 ? "+" : ""}${pair.change} pips since the New York open`}</Text>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <Figure label="Bid" value={price(pair, pair.bid)} />
          <Figure label="Ask" value={price(pair, pair.ask)} />
          <Figure label="Day's low" value={price(pair, pair.low)} />
          <Figure label="Day's high" value={price(pair, pair.high)} />
        </GridLayout>
        <StackLayout gap={1}>
          <H3 id="recent-quotes">Recent quotes</H3>
          <TableContainer>
            <Table aria-labelledby="recent-quotes" variant="secondary">
              <THead>
                <TR>
                  <TH>Time (ET)</TH>
                  <TH textAlign="right">Bid</TH>
                  <TH textAlign="right">Ask</TH>
                </TR>
              </THead>
              <TBody>
                {quotes.map((quote) => (
                  <TR key={quote.time}>
                    <TD className={styles.figure}>{quote.time}</TD>
                    <TD textAlign="right" className={styles.figure}>
                      {price(pair, quote.bid)}
                    </TD>
                    <TD textAlign="right" className={styles.figure}>
                      {price(pair, quote.ask)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </StackLayout>
      </StackLayout>
    </Panel>
  );
}
