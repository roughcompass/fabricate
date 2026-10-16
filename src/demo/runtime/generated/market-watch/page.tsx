// Market watch: the Watch route as one page, composed from its microfrontends at their conformant versions:
// watchlist 1.9.0 (main)
// order-ticket 2.2.0 (side)
// price-chart 5.1.0 (wide)
// trade-blotter 3.5.0 (wide)
import { planted, useBus, useProfile, usePublish } from "@deweb/portal";
import { Button, Card, Dropdown, FlexLayout, FormField, FormFieldLabel, GridItem, GridLayout, H2, Input, Label, Option, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { ArrowDownIcon, ArrowUpIcon, RefreshIcon } from "@salt-ds/icons";
import { useState } from "react";
import { type Instrument, INSTRUMENTS, TRADES } from "./data";

const Watchlist_formatChange = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;

function Watchlist() {
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
                        {Watchlist_formatChange(entry.change)}
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

const OrderTicket_MEMBER = "order-ticket";

const OrderTicket_instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);

const OrderTicket_SIDES: Record<string, string> = { buy: "Buy", sell: "Sell" };

const OrderTicket_TYPES: Record<string, string> = { limit: "Limit", market: "Market" };

function OrderTicket() {
  const [symbol, setSymbol] = useState<string>(INSTRUMENTS[0]!.symbol);
  const [side, setSide] = useState("buy");
  const [type, setType] = useState("limit");
  const [quantity, setQuantity] = useState("");
  const [limit, setLimit] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  useBus("instrument:selected", OrderTicket_MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown })?.symbol;
    if (typeof next === "string" && OrderTicket_instrument(next)) setSymbol(next);
  });

  const entry = OrderTicket_instrument(symbol)!;

  return (
    <Panel data-demo-anchor="order-panel">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(
            `${side === "sell" ? "Sell" : "Buy"} ${quantity || 0} ${symbol} at ${
              type === "market" ? "market" : `limit ${limit || entry.price.toFixed(2)}`
            } submitted.`,
          );
        }}
      >
        <StackLayout gap={2}>
          <StackLayout gap={0.5}>
            <Text styleAs="label" color="secondary">
              <H2 styleAs="label">Order ticket</H2>
            </Text>
            <Text styleAs="h3" data-demo-anchor="order-symbol">
              {`${entry.symbol} · ${entry.name}`}
            </Text>
          </StackLayout>

          <GridLayout columns={2} gap={1}>
            <GridItem>
              <FormField>
                <FormFieldLabel>Side</FormFieldLabel>
                <Dropdown
                  data-demo-anchor="order-side"
                  selected={[side]}
                  valueToString={(item) => OrderTicket_SIDES[item] ?? item}
                  onSelectionChange={(_event, next) => {
                    if (next[0]) setSide(next[0]);
                  }}
                >
                  <Option value="buy">Buy</Option>
                  <Option value="sell">Sell</Option>
                </Dropdown>
              </FormField>
            </GridItem>
            <GridItem>
              <FormField>
                <FormFieldLabel>Order type</FormFieldLabel>
                <Dropdown
                  data-demo-anchor="order-type"
                  selected={[type]}
                  valueToString={(item) => OrderTicket_TYPES[item] ?? item}
                  onSelectionChange={(_event, next) => {
                    if (next[0]) setType(next[0]);
                  }}
                >
                  <Option value="limit">Limit</Option>
                  <Option value="market">Market</Option>
                </Dropdown>
              </FormField>
            </GridItem>
          </GridLayout>

          <FormField>
            <FormFieldLabel>Quantity</FormFieldLabel>
            <Input
              data-demo-anchor="order-quantity"
              placeholder="100"
              value={quantity}
              onChange={(event) => setQuantity((event.target as HTMLInputElement).value)}
              inputProps={{ name: "quantity", inputMode: "numeric" }}
            />
          </FormField>

          <FormField>
            <FormFieldLabel>Limit price</FormFieldLabel>
            <Input
              data-demo-anchor="order-limit"
              placeholder={entry.price.toFixed(2)}
              value={limit}
              onChange={(event) => setLimit((event.target as HTMLInputElement).value)}
              inputProps={{ name: "limit", inputMode: "decimal" }}
            />
          </FormField>

          <Button sentiment="accented" appearance="solid" type="submit" data-demo-anchor="submit-order">
            Submit order
          </Button>

          <Text role="status" color="secondary">
            {submitted ?? ""}
          </Text>
        </StackLayout>
      </form>
    </Panel>
  );
}

const PriceChart_MEMBER = "price-chart";

const PriceChart_instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);

const PriceChart_formatChange = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;

function PriceChart_series(symbol: string, points = 32): number[] {
  const base = PriceChart_instrument(symbol)?.price ?? 100;
  let seed = [...symbol].reduce((total, char) => total * 31 + char.charCodeAt(0), 7) % 2147483648;
  const open = base * (1 - (PriceChart_instrument(symbol)?.change ?? 0) / 100);
  const values: number[] = [];
  for (let index = 0; index < points; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const trend = open + ((base - open) * index) / (points - 1);
    const noise = index === 0 || index === points - 1 ? 0 : (seed / 2147483648 - 0.5) * base * 0.01;
    values.push(Number((trend + noise).toFixed(2)));
  }
  return values;
}

function PriceChart() {
  const [symbol, setSymbol] = useState(INSTRUMENTS[0]!.symbol);
  useBus("instrument:selected", PriceChart_MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown })?.symbol;
    if (typeof next === "string" && PriceChart_instrument(next)) setSymbol(next);
  });

  const entry = PriceChart_instrument(symbol)!;
  const values = PriceChart_series(symbol);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index: number) => (index / (values.length - 1)) * 600;
  const y = (value: number) => 150 - ((value - min) / (max - min || 1)) * 130;
  const line = values
    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(" ");
  const positive = entry.change >= 0;
  const ChangeIcon = positive ? ArrowUpIcon : ArrowDownIcon;
  const lineColor = positive ? "var(--salt-sentiment-positive-foreground-informative)" : "var(--salt-sentiment-negative-foreground-informative)";

  return (
    <Panel data-demo-anchor="price-chart-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <H2>{`Price chart · ${entry.symbol}`}</H2>
          <FlexLayout gap={1} align="center">
            <ChangeIcon aria-hidden />
            <Text color={positive ? "success" : "error"}>
              <strong>{PriceChart_formatChange(entry.change)}</strong>
            </Text>
          </FlexLayout>
        </FlexLayout>

        <FlexLayout gap={3} align="end" wrap>
          <StackLayout gap={0}>
            <Label color="secondary">Last</Label>
            <Text styleAs="display3">{entry.price.toFixed(2)}</Text>
          </StackLayout>
          <StackLayout gap={0}>
            <Label color="secondary">Day range</Label>
            <Text styleAs="h3">{`${min.toFixed(2)} – ${max.toFixed(2)}`}</Text>
          </StackLayout>
        </FlexLayout>

        <svg
          viewBox="0 0 600 180"
          preserveAspectRatio="none"
          role="img"
          width="100%"
          aria-label={`${entry.name} price over the session, from ${values[0]!.toFixed(2)} to ${entry.price.toFixed(2)}`}
          data-demo-anchor="price-chart"
          style={{
            blockSize: "calc(var(--salt-size-base) * 7)",
            display: "block",
            borderBottomWidth: "var(--salt-size-border)",
            borderBottomStyle: "solid",
            borderBottomColor: "var(--salt-separable-secondary-borderColor)",
          }}
        >
          <path d={`${line} L600,170 L0,170 Z`} fill={lineColor} fillOpacity={0.15} stroke="none" />
          {values.map((value, index) => (
            <rect
              key={index}
              x={x(index) - 4}
              y={170 - ((index * 7 + value) % 22)}
              width={8}
              height={(index * 7 + value) % 22}
              fill="var(--salt-content-secondary-foreground)"
              fillOpacity={0.45}
            />
          ))}
          <path d={line} fill="none" stroke={lineColor} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>

        <Text color="secondary">Area chart with volume bars.</Text>
      </StackLayout>
    </Panel>
  );
}

function TradeBlotter_Metric({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
}) {
  return (
    <StackLayout gap={0.5}>
      <Text color="secondary">{label}</Text>
      <Text styleAs={emphasis ? "display3" : "h2"} aria-live="polite">
        {value}
      </Text>
      {detail && (
        <Text styleAs="label" color="secondary">
          {detail}
        </Text>
      )}
    </StackLayout>
  );
}

function TradeBlotter() {
  const approver = useProfile().persona === "Approver";
  const [allocated, setAllocated] = useState<readonly string[]>([]);
  const [exposure, setExposure] = useState("$1.42M");

  return (
    <Card data-demo-anchor="blotter-panel">
      <StackLayout gap={3}>
        <FlexLayout justify="space-between" align="center" wrap gap={2}>
          <H2>Trade blotter</H2>
          <Button
            sentiment="neutral"
            appearance="bordered"
            onClick={() => {
              planted.blockMainThread(650);
              setExposure("$1.43M");
            }}
            data-demo-anchor="recalculate-exposure"
          >
            <RefreshIcon aria-hidden />
            Recalculate exposure
          </Button>
        </FlexLayout>

        <FlexLayout gap={3} wrap align="end">
          <TradeBlotter_Metric
            label="Awaiting allocation"
            value={`${2 - allocated.length}`}
            detail="Approver allocates"
            emphasis
          />
          <TradeBlotter_Metric label="Gross exposure" value={exposure} />
          <TradeBlotter_Metric label="Trades today" value="4" />
        </FlexLayout>

        <TableContainer>
          <Table aria-label="Trades">
            <THead>
              <TR>
                <TH>Trade</TH>
                <TH>Symbol</TH>
                <TH>Side</TH>
                <TH style={{ textAlign: "right" }}>Quantity</TH>
                <TH style={{ textAlign: "right" }}>Price</TH>
                <TH>Status</TH>
                {approver && <TH>Allocation</TH>}
              </TR>
            </THead>
            <TBody>
              {TRADES.map((trade) => {
                const status: string = allocated.includes(trade.id) ? "Allocated" : trade.status;
                const awaiting = status === "Awaiting allocation";
                return (
                  <TR key={trade.id} data-demo-anchor={`trade-${trade.id}`}>
                    <TD>{trade.id}</TD>
                    <TD>{trade.symbol}</TD>
                    <TD>{trade.side}</TD>
                    <TD style={{ textAlign: "right" }}>{trade.quantity}</TD>
                    <TD style={{ textAlign: "right" }}>{trade.price}</TD>
                    <TD>
                      <FlexLayout gap={1} align="center">
                        <StatusIndicator status={awaiting ? "info" : "success"} />
                        <Text>{status}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {awaiting ? (
                          <Button
                            sentiment="accented"
                            onClick={() => setAllocated((ids) => [...ids, trade.id])}
                            data-demo-anchor={`approve-${trade.id}`}
                          >
                            {`Approve ${trade.id}`}
                          </Button>
                        ) : (
                          <Text color="secondary">None needed</Text>
                        )}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableContainer>

        {!approver && <Text color="secondary">Allocations are approved by the Approver role.</Text>}
      </StackLayout>
    </Card>
  );
}

export default function MarketWatch() {
  return (
    <GridLayout columns={3} gap={3}>
      <GridItem colSpan={2}>
        <Watchlist />
      </GridItem>
      <GridItem colSpan={1}>
        <OrderTicket />
      </GridItem>
      <GridItem colSpan={3}>
        <PriceChart />
      </GridItem>
      <GridItem colSpan={3}>
        <TradeBlotter />
      </GridItem>
    </GridLayout>
  );
}
