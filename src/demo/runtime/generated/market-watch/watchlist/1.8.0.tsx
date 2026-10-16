import { useState } from "react";
import {
  Button,
  H2,
  Input,
  Panel,
  StackLayout,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Text,
} from "@salt-ds/core";
import { ChartLineIcon } from "@salt-ds/icons";
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
        <H2>Watchlist</H2>
        <StackLayout gap={1}>
          <Text color="secondary">Filter symbols</Text>
          {/* Planted defect (label): no FormField label and no aria-label. */}
          <Input
            value={filter}
            onChange={(event) => setFilter((event.target as HTMLInputElement).value)}
            inputProps={{ "data-demo-anchor": "watchlist-filter" } as Record<string, string>}
          />
        </StackLayout>
        <TableContainer>
          <Table aria-label="Watchlist">
            <THead>
              <TR>
                <TH>Symbol</TH>
                <TH style={{ textAlign: "right" }}>Last</TH>
                <TH style={{ textAlign: "right" }}>Change</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {rows.map((entry) => {
                const isSelected = selected === entry.symbol;
                return (
                  <TR
                    key={entry.symbol}
                    data-demo-anchor={`instrument-${entry.symbol}`}
                    aria-selected={isSelected}
                  >
                    <TD>
                      <Text>
                        <strong>{entry.symbol}</strong>{" "}
                        {/* Planted defect (color-contrast): faint literal gray. */}
                        <span style={{ color: "#b0b0b0" }}>{entry.name}</span>
                      </Text>
                    </TD>
                    <TD style={{ textAlign: "right" }}>{entry.price.toFixed(2)}</TD>
                    <TD style={{ textAlign: "right" }}>
                      <Text color={entry.change >= 0 ? "success" : "error"}>
                        {formatChange(entry.change)}
                      </Text>
                    </TD>
                    <TD>
                      {/* Planted defect (button-name): icon-only; aria-labelledby points to an element that does not exist, so the computed name is empty. */}
                      <Button
                        appearance={isSelected ? "solid" : "transparent"}
                        sentiment={isSelected ? "accented" : "neutral"}
                        onClick={() => choose(entry)}
                        aria-pressed={isSelected}
                        aria-labelledby={`watchlist-chart-name-${entry.symbol}`}
                        data-demo-anchor={`chart-${entry.symbol}`}
                      >
                        <ChartLineIcon aria-hidden />
                      </Button>
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
