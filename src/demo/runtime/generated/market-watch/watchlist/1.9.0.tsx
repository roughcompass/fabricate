import { useState } from "react";
import {
  Button,
  FormField,
  FormFieldLabel,
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
        <FormField>
          <FormFieldLabel>Filter symbols</FormFieldLabel>
          <Input
            placeholder="Symbol or name"
            value={filter}
            onChange={(event) => setFilter((event.target as HTMLInputElement).value)}
            inputProps={{ "data-demo-anchor": "watchlist-filter" } as Record<string, string>}
          />
        </FormField>
        <TableContainer>
          <Table aria-label="Watchlist">
            <THead>
              <TR>
                <TH>Symbol</TH>
                <TH style={{ textAlign: "right" }}>Last</TH>
                <TH style={{ textAlign: "right" }}>Change</TH>
                <TH>Chart</TH>
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
                      <StackLayout gap={0}>
                        <Text>
                          <strong>{entry.symbol}</strong>
                        </Text>
                        <Text color="secondary" styleAs="label">
                          {entry.name}
                        </Text>
                      </StackLayout>
                    </TD>
                    <TD style={{ textAlign: "right" }}>{entry.price.toFixed(2)}</TD>
                    <TD style={{ textAlign: "right" }}>
                      <Text color={entry.change >= 0 ? "success" : "error"}>
                        {formatChange(entry.change)}
                      </Text>
                    </TD>
                    <TD>
                      <Button
                        appearance={isSelected ? "solid" : "transparent"}
                        sentiment={isSelected ? "accented" : "neutral"}
                        onClick={() => choose(entry)}
                        aria-label={`Chart ${entry.symbol}`}
                        aria-pressed={isSelected}
                        data-demo-anchor={`chart-${entry.symbol}`}
                      >
                        Chart
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
