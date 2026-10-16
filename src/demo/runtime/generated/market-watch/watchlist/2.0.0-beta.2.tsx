import { useState } from "react";
import {
  Button,
  FlexLayout,
  FormField,
  FormFieldLabel,
  GridItem,
  GridLayout,
  H2,
  Input,
  LinearProgress,
  Panel,
  StackLayout,
  Tag,
  Text,
} from "@salt-ds/core";
import { usePublish } from "@deweb/portal";
import { INSTRUMENTS, type Instrument } from "../data";

const formatChange = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;

export default function Watchlist() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(INSTRUMENTS[0]!.symbol);
  const publish = usePublish("watchlist");

  const query = filter.trim().toLowerCase();
  const rows = INSTRUMENTS.filter((entry) =>
    `${entry.symbol} ${entry.name}`.toLowerCase().includes(query),
  );

  const choose = (entry: Instrument) => {
    setSelected(entry.symbol);
    publish("instrument:selected", { symbol: entry.symbol, name: entry.name });
  };

  return (
    <Panel data-demo-anchor="watchlist-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={1}>
          <H2>Watchlist</H2>
          <Tag>Preview: price tiles</Tag>
        </FlexLayout>
        <FormField>
          <FormFieldLabel>Filter symbols</FormFieldLabel>
          <Input
            placeholder="Symbol or name"
            value={filter}
            onChange={(event) => setFilter((event.target as HTMLInputElement).value)}
            inputProps={{ "data-demo-anchor": "watchlist-filter" } as Record<string, string>}
          />
        </FormField>
        <GridLayout columns={3} gap={1} role="list">
          {rows.map((entry) => {
            const isSelected = selected === entry.symbol;
            const up = entry.change >= 0;
            const barValue = Math.min(100, Math.abs(entry.change) * 30);
            return (
              <GridItem key={entry.symbol} role="listitem">
                <StackLayout gap={0}>
                  <Button
                    appearance={isSelected ? "solid" : "bordered"}
                    sentiment={isSelected ? "accented" : "neutral"}
                    onClick={() => choose(entry)}
                    aria-pressed={isSelected}
                    data-demo-anchor={`instrument-${entry.symbol}`}
                    style={{
                      height: "auto",
                      justifyContent: "flex-start",
                      padding: "var(--salt-spacing-100)",
                    }}
                  >
                    <StackLayout gap={0.5} align="stretch">
                      <Text color="inherit">
                        <strong>{entry.symbol}</strong>
                      </Text>
                      <Text color="inherit">{entry.price.toFixed(2)}</Text>
                      <Text color={isSelected ? "inherit" : up ? "success" : "error"}>
                        {formatChange(entry.change)}
                      </Text>
                      <LinearProgress
                        aria-hidden
                        data-direction={up ? "up" : "down"}
                        value={barValue}
                        hideLabel
                      />
                    </StackLayout>
                  </Button>
                </StackLayout>
              </GridItem>
            );
          })}
        </GridLayout>
      </StackLayout>
    </Panel>
  );
}
