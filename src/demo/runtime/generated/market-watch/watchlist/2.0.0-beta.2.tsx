import { usePublish } from "@deweb/portal";
import { Display4, FlexLayout, FormField, FormFieldLabel, GridLayout, H2, Input, InteractableCard, InteractableCardGroup, LinearProgress, Panel, StackLayout, Tag, Text } from "@salt-ds/core";
import { FilterIcon } from "@salt-ds/icons";
import { type ChangeEvent, type SyntheticEvent, useState } from "react";
import { INSTRUMENTS, UPDATED } from "../data";
import styles from "./2.0.0-beta.2.module.css";

const signed = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
const tone = (change: number) => (change > 0 ? "success" : change < 0 ? "error" : "secondary");
/** The largest move on the list, so each tile's bar shows its move against it. */
const LARGEST = Math.max(...INSTRUMENTS.map((entry) => Math.abs(entry.change)));

export default function Watchlist() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(INSTRUMENTS[0]!.symbol);
  const publish = usePublish("watchlist");
  const query = filter.trim().toLowerCase();
  const tiles = INSTRUMENTS.filter((entry) => `${entry.symbol} ${entry.name}`.toLowerCase().includes(query));

  const choose = (_event: SyntheticEvent<HTMLDivElement>, value: unknown) => {
    const entry = INSTRUMENTS.find((instrument) => instrument.symbol === value);
    if (!entry) return;
    setSelected(entry.symbol);
    publish("instrument:selected", { symbol: entry.symbol, name: entry.name });
  };

  return (
    <Panel data-demo-anchor="watchlist-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={1} wrap>
          <H2>Watchlist</H2>
          <Tag>Preview: price tiles</Tag>
        </FlexLayout>
        <Text styleAs="label" color="secondary">{`Delayed 15 minutes, updated ${UPDATED}. Bars compare each move with the day's largest.`}</Text>
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
        {tiles.length === 0 ? (
          <Text color="secondary">{`No instruments match "${filter.trim()}". Clear the filter to see every instrument.`}</Text>
        ) : (
          <InteractableCardGroup aria-label="Watchlist" value={selected} onChange={choose}>
            <GridLayout columns={{ xs: 1, sm: 2, lg: 3 }} gap={1} className={styles.tiles}>
              {tiles.map((entry) => (
                <InteractableCard key={entry.symbol} value={entry.symbol} data-demo-anchor={`instrument-${entry.symbol}`}>
                  <StackLayout gap={1}>
                    <FlexLayout justify="space-between" align="baseline" gap={1}>
                      <Text fontWeight="bolder">{entry.symbol}</Text>
                      <Text color={tone(entry.change)} className={styles.figure}>
                        {signed(entry.change)}
                      </Text>
                    </FlexLayout>
                    <Text styleAs="label" color="secondary">
                      {entry.name}
                    </Text>
                    <Display4 className={styles.figure}>{entry.price.toFixed(2)}</Display4>
                    <LinearProgress aria-hidden value={Math.round((Math.abs(entry.change) / LARGEST) * 100)} hideLabel />
                  </StackLayout>
                </InteractableCard>
              ))}
            </GridLayout>
          </InteractableCardGroup>
        )}
      </StackLayout>
    </Panel>
  );
}
