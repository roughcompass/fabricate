import { usePublish } from "@deweb/portal";
import { Button, FlexLayout, FormField, FormFieldLabel, H2, Input, Panel, StackLayout, TBody, TD, TH, THead, TR, Table, TableContainer, Text } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { type FxPair, PAIRS, UPDATED } from "../data";
import styles from "./1.0.0.module.css";

const price = (pair: FxPair, value: number) => value.toFixed(pair.decimals);
const spread = (pair: FxPair) => ((pair.ask - pair.bid) / pair.pip).toFixed(1);
const signed = (pips: number) => (pips > 0 ? `+${pips}` : `${pips}`);
const tone = (pips: number) => (pips > 0 ? "success" : pips < 0 ? "error" : "secondary");

export default function FxRates() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(PAIRS[0]!.id);
  const publish = usePublish("fx-rates");
  const search = query.trim().toLowerCase();
  const rows = PAIRS.filter((pair) => pair.pair.toLowerCase().includes(search) || pair.name.toLowerCase().includes(search));

  const choose = (pair: FxPair) => {
    setSelected(pair.id);
    publish("pair:selected", { id: pair.id, name: pair.pair });
  };

  return (
    <Panel data-demo-anchor="fx-rates-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>FX rates</H2>
          <Text styleAs="label" color="secondary">{`Indicative, updated ${UPDATED}`}</Text>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Find a pair</FormFieldLabel>
          <Input
            startAdornment={<SearchIcon aria-hidden />}
            placeholder="EUR/USD or euro"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            inputProps={{ type: "search", "data-demo-anchor": "fx-search" }}
          />
        </FormField>
        {rows.length === 0 ? (
          <Text color="secondary">{`No pairs match "${query.trim()}". Clear the search to see every pair.`}</Text>
        ) : (
          <TableContainer>
            <Table aria-label="FX rates">
              <THead sticky>
                <TR>
                  <TH>Pair</TH>
                  <TH textAlign="right">Bid</TH>
                  <TH textAlign="right">Ask</TH>
                  <TH textAlign="right">Spread (pips)</TH>
                  <TH textAlign="right">Change (pips)</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((pair) => {
                  const current = pair.id === selected;
                  return (
                    <TR key={pair.id} aria-current={current ? "true" : undefined} className={current ? styles.selected : undefined} data-demo-anchor={`pair-${pair.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(pair)}>
                          {pair.pair}
                        </Button>
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {price(pair, pair.bid)}
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {price(pair, pair.ask)}
                      </TD>
                      <TD textAlign="right" className={styles.figure}>
                        {spread(pair)}
                      </TD>
                      <TD textAlign="right">
                        <Text color={tone(pair.change)} className={styles.figure}>
                          {signed(pair.change)}
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
