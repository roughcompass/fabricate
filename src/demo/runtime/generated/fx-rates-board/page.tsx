// FX rates board: the Rates route as one page, composed from its microfrontends at their conformant versions:
// fx-rates 1.1.0 (main)
// rate-detail 1.0.0 (side)
import { useBus, usePublish } from "@deweb/portal";
import { Button, Display4, FlexLayout, FormField, FormFieldLabel, GridItem, GridLayout, H2, H3, Input, LinearProgress, Panel, StackLayout, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { SearchIcon } from "@salt-ds/icons";
import { type ChangeEvent, useState } from "react";
import { type FxPair, PAIRS, QUOTES, UPDATED } from "./data";
import styles from "./page.module.css";

const FxRates_price = (pair: FxPair, value: number) => value.toFixed(pair.decimals);

const FxRates_spread = (pair: FxPair) => ((pair.ask - pair.bid) / pair.pip).toFixed(1);

const FxRates_signed = (pips: number) => (pips > 0 ? `+${pips}` : `${pips}`);

const FxRates_tone = (pips: number) => (pips > 0 ? "success" : pips < 0 ? "error" : "secondary");

const FxRates_position = (pair: FxPair) => Math.round(((pair.bid - pair.low) / (pair.high - pair.low)) * 100);

function FxRates() {
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
                  <TH>Daily range</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((pair) => {
                  const current = pair.id === selected;
                  return (
                    <TR key={pair.id} aria-current={current ? "true" : undefined} className={current ? styles["FxRates_selected"] : undefined} data-demo-anchor={`pair-${pair.id}`}>
                      <TD>
                        <Button sentiment="neutral" appearance="transparent" aria-pressed={current} onClick={() => choose(pair)}>
                          {pair.pair}
                        </Button>
                      </TD>
                      <TD textAlign="right" className={styles["FxRates_figure"]}>
                        {FxRates_price(pair, pair.bid)}
                      </TD>
                      <TD textAlign="right" className={styles["FxRates_figure"]}>
                        {FxRates_price(pair, pair.ask)}
                      </TD>
                      <TD textAlign="right" className={styles["FxRates_figure"]}>
                        {FxRates_spread(pair)}
                      </TD>
                      <TD textAlign="right">
                        <Text color={FxRates_tone(pair.change)} className={styles["FxRates_figure"]}>
                          {FxRates_signed(pair.change)}
                        </Text>
                      </TD>
                      <TD>
                        <StackLayout gap={1}>
                          <LinearProgress value={FxRates_position(pair)} hideLabel aria-label={`${pair.pair} bid at ${FxRates_position(pair)}% of the day's range`} />
                          <Text styleAs="label" color="secondary" className={styles["FxRates_figure"]}>{`${FxRates_price(pair, pair.low)} – ${FxRates_price(pair, pair.high)}`}</Text>
                        </StackLayout>
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

const RateDetail_price = (pair: FxPair, value: number) => value.toFixed(pair.decimals);

const RateDetail_tone = (pips: number) => (pips > 0 ? "success" : pips < 0 ? "error" : "secondary");

function RateDetail_Figure({ label, value }: { label: string; value: string }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Text className={styles["RateDetail_figure"]}>{value}</Text>
    </StackLayout>
  );
}

function RateDetail() {
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
          <Display4 className={styles["RateDetail_figure"]}>{RateDetail_price(pair, mid)}</Display4>
          <Text color={RateDetail_tone(pair.change)}>{`${pair.change > 0 ? "+" : ""}${pair.change} pips since the New York open`}</Text>
        </StackLayout>
        <GridLayout columns={2} gap={2}>
          <RateDetail_Figure label="Bid" value={RateDetail_price(pair, pair.bid)} />
          <RateDetail_Figure label="Ask" value={RateDetail_price(pair, pair.ask)} />
          <RateDetail_Figure label="Day's low" value={RateDetail_price(pair, pair.low)} />
          <RateDetail_Figure label="Day's high" value={RateDetail_price(pair, pair.high)} />
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
                    <TD className={styles["RateDetail_figure"]}>{quote.time}</TD>
                    <TD textAlign="right" className={styles["RateDetail_figure"]}>
                      {RateDetail_price(pair, quote.bid)}
                    </TD>
                    <TD textAlign="right" className={styles["RateDetail_figure"]}>
                      {RateDetail_price(pair, quote.ask)}
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

export default function FxRatesBoard() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <FxRates />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <RateDetail />
      </GridItem>
    </GridLayout>
  );
}
