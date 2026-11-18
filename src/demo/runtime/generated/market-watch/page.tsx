// Market watch: the Watch route as one page, composed from its microfrontends at their conformant versions:
// watchlist 1.9.0 (main)
// order-ticket 2.2.0 (side)
// price-chart 5.1.0 (wide)
// trade-blotter 3.5.0 (wide)
import { useBus, useProfile, usePublish } from "@deweb/portal";
import { Button, Display3, Dropdown, FlexLayout, FormField, FormFieldHelperText, FormFieldLabel, GridItem, GridLayout, H2, Input, NumberInput, Option, Panel, StackLayout, StatusIndicator, Table, TableContainer, TBody, TD, Text, TH, THead, TR } from "@salt-ds/core";
import { ArrowDownIcon, ArrowUpIcon, FilterIcon, RefreshIcon } from "@salt-ds/icons";
import { type ChangeEvent, type FormEvent, type SyntheticEvent, useState } from "react";
import { EXPOSURE, type Instrument, INSTRUMENTS, SESSION, TRADES, UPDATED } from "./data";
import styles from "./page.module.css";

const Watchlist_signed = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;

const Watchlist_tone = (change: number) => (change > 0 ? "success" : change < 0 ? "error" : "secondary");

function Watchlist() {
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
                    <TR key={entry.symbol} aria-current={current ? "true" : undefined} className={current ? styles["Watchlist_selected"] : undefined} data-demo-anchor={`instrument-${entry.symbol}`}>
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
                      <TD textAlign="right" className={styles["Watchlist_figure"]}>
                        {entry.price.toFixed(2)}
                      </TD>
                      <TD textAlign="right">
                        <Text color={Watchlist_tone(entry.change)} className={styles["Watchlist_figure"]}>
                          {Watchlist_signed(entry.change)}
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

const OrderTicket_MEMBER = "order-ticket";

const OrderTicket_instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);

const OrderTicket_usd = (value: number) => `USD ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const OrderTicket_SIDES: Record<string, string> = { buy: "Buy", sell: "Sell" };

const OrderTicket_TYPES: Record<string, string> = { limit: "Limit", market: "Market" };

function OrderTicket() {
  const [symbol, setSymbol] = useState<string>(INSTRUMENTS[0]!.symbol);
  const [side, setSide] = useState("buy");
  const [type, setType] = useState("limit");
  const [quantity, setQuantity] = useState("");
  const [limit, setLimit] = useState("");
  const [checked, setChecked] = useState(false);
  const [submitted, setSubmitted] = useState("");

  useBus("instrument:selected", OrderTicket_MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown } | null)?.symbol;
    if (typeof next === "string" && OrderTicket_instrument(next)) {
      setSymbol(next);
      setSubmitted("");
    }
  });

  const entry = OrderTicket_instrument(symbol)!;
  const market = type === "market";
  const shares = Number(quantity);
  const quantityValid = Number.isInteger(shares) && shares > 0;
  const price = market ? entry.price : Number(limit || entry.price);
  const priceValid = market || (Number.isFinite(price) && price > 0);
  const quantityError = checked && !quantityValid;
  const priceError = checked && !priceValid;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if (!quantityValid || !priceValid) {
      setSubmitted("");
      return;
    }
    setChecked(false);
    setSubmitted(`${OrderTicket_SIDES[side]} ${shares.toLocaleString("en-US")} ${symbol} at ${market ? "market" : `limit ${OrderTicket_usd(price)}`} submitted.`);
  };

  return (
    <Panel data-demo-anchor="order-panel">
      <form onSubmit={submit} noValidate>
        <StackLayout gap={2}>
          <StackLayout gap={1}>
            <H2>Order ticket</H2>
            <Text fontWeight="bolder" data-demo-anchor="order-symbol">
              {`${entry.symbol} · ${entry.name}`}
            </Text>
            <Text styleAs="label" color="secondary" className={styles["OrderTicket_figure"]}>{`Last ${OrderTicket_usd(entry.price)}`}</Text>
          </StackLayout>

          <GridLayout columns={{ xs: 1, sm: 2, md: 1, xl: 2 }} gap={2}>
            <FormField>
              <FormFieldLabel>Side</FormFieldLabel>
              <Dropdown
                data-demo-anchor="order-side"
                selected={[side]}
                valueToString={(item: string) => OrderTicket_SIDES[item] ?? item}
                onSelectionChange={(_event: SyntheticEvent, next: string[]) => {
                  if (next[0]) setSide(next[0]);
                }}
              >
                <Option value="buy">Buy</Option>
                <Option value="sell">Sell</Option>
              </Dropdown>
            </FormField>
            <FormField>
              <FormFieldLabel>Order type</FormFieldLabel>
              <Dropdown
                data-demo-anchor="order-type"
                selected={[type]}
                valueToString={(item: string) => OrderTicket_TYPES[item] ?? item}
                onSelectionChange={(_event: SyntheticEvent, next: string[]) => {
                  if (next[0]) setType(next[0]);
                }}
              >
                <Option value="limit">Limit</Option>
                <Option value="market">Market</Option>
              </Dropdown>
            </FormField>
          </GridLayout>

          <FormField validationStatus={quantityError ? "error" : undefined}>
            <FormFieldLabel>Quantity</FormFieldLabel>
            <NumberInput
              data-demo-anchor="order-quantity"
              placeholder="100"
              min={1}
              step={100}
              decimalScale={0}
              value={quantity}
              onChange={(_event: SyntheticEvent | null, value: string) => setQuantity(value)}
              inputProps={{ name: "quantity" }}
            />
            <FormFieldHelperText>{quantityError ? "Enter a whole number of shares, 1 or more." : "Shares, in whole numbers."}</FormFieldHelperText>
          </FormField>

          <FormField disabled={market} validationStatus={priceError ? "error" : undefined}>
            <FormFieldLabel>Limit price (USD)</FormFieldLabel>
            <NumberInput
              data-demo-anchor="order-limit"
              placeholder={entry.price.toFixed(2)}
              min={0.01}
              step={0.01}
              decimalScale={2}
              hideButtons
              value={market ? "" : limit}
              onChange={(_event: SyntheticEvent | null, value: string) => setLimit(value)}
              inputProps={{ name: "limit" }}
            />
            <FormFieldHelperText>{market ? "A market order fills at the best available price." : priceError ? "Enter a price above 0, or leave it blank to use the last price." : "Leave blank to use the last price."}</FormFieldHelperText>
          </FormField>

          <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
            <Text styleAs="label" color="secondary">
              Estimated value
            </Text>
            <Text className={styles["OrderTicket_figure"]}>{quantityValid && priceValid ? OrderTicket_usd(shares * price) : "—"}</Text>
          </FlexLayout>

          <Button sentiment="accented" appearance="solid" type="submit" data-demo-anchor="submit-order">
            Submit order
          </Button>

          <Text role="status" color="secondary">
            {submitted}
          </Text>
        </StackLayout>
      </form>
    </Panel>
  );
}

const PriceChart_MEMBER = "price-chart";

const PriceChart_POINTS = 32;

const PriceChart_WIDTH = 720;

const PriceChart_HEIGHT = 240;

const PriceChart_PAD = 12;

const PriceChart_PRICE_BASE = 168;

const PriceChart_VOLUME_TOP = 184;

const PriceChart_instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);

const PriceChart_signed = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;

const PriceChart_millions = (shares: number) => `${(shares / 1_000_000).toFixed(2)}M`;

function PriceChart_series(symbol: string): { prices: number[]; volumes: number[] } {
  const base = PriceChart_instrument(symbol)?.price ?? 100;
  let seed = [...symbol].reduce((total, char) => total * 31 + char.charCodeAt(0), 7) % 2147483648;
  const open = base * (1 - (PriceChart_instrument(symbol)?.change ?? 0) / 100);
  const prices: number[] = [];
  const volumes: number[] = [];
  for (let index = 0; index < PriceChart_POINTS; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const random = seed / 2147483648;
    const trend = open + ((base - open) * index) / (PriceChart_POINTS - 1);
    const noise = index === 0 || index === PriceChart_POINTS - 1 ? 0 : (random - 0.5) * base * 0.01;
    prices.push(Number((trend + noise).toFixed(2)));
    // Volume is heaviest at the open and tapers through the day.
    volumes.push(Math.round((40_000 + random * 90_000) * (index < 4 ? 2.2 - index * 0.3 : 1)));
  }
  return { prices, volumes };
}

function PriceChart() {
  const [symbol, setSymbol] = useState(INSTRUMENTS[0]!.symbol);
  useBus("instrument:selected", PriceChart_MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown } | null)?.symbol;
    if (typeof next === "string" && PriceChart_instrument(next)) setSymbol(next);
  });

  const entry = PriceChart_instrument(symbol)!;
  const { prices, volumes } = PriceChart_series(symbol);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const peak = Math.max(...volumes);
  const traded = volumes.reduce((total, volume) => total + volume, 0);

  const step = PriceChart_WIDTH / PriceChart_POINTS;
  const x = (index: number) => step * index + step / 2;
  const y = (value: number) => PriceChart_PAD + (1 - (value - low) / (high - low || 1)) * (PriceChart_PRICE_BASE - PriceChart_PAD * 2);
  const line = prices.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(PriceChart_POINTS - 1).toFixed(1)},${PriceChart_PRICE_BASE} L${x(0).toFixed(1)},${PriceChart_PRICE_BASE} Z`;
  const positive = entry.change >= 0;
  const ChangeIcon = positive ? ArrowUpIcon : ArrowDownIcon;
  const color = positive ? "var(--salt-sentiment-positive-dataviz)" : "var(--salt-sentiment-negative-dataviz)";

  return (
    <Panel data-demo-anchor="price-chart-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>{`Price chart · ${entry.symbol}`}</H2>
          <Text styleAs="label" color="secondary">{`${entry.name}, ${SESSION.date}`}</Text>
        </FlexLayout>

        <GridLayout columns={{ xs: 1, sm: 2, md: 4 }} gap={2}>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              Last (USD)
            </Text>
            <Display3 className={styles["PriceChart_figure"]}>{entry.price.toFixed(2)}</Display3>
          </StackLayout>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              Change on the day
            </Text>
            <FlexLayout gap={1} align="center">
              <ChangeIcon aria-hidden />
              <Text color={positive ? "success" : "error"} fontWeight="bolder" className={styles["PriceChart_figure"]}>
                {PriceChart_signed(entry.change)}
              </Text>
            </FlexLayout>
          </StackLayout>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              Day range (USD)
            </Text>
            <Text className={styles["PriceChart_figure"]}>{`${low.toFixed(2)} – ${high.toFixed(2)}`}</Text>
          </StackLayout>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              Volume (shares)
            </Text>
            <Text className={styles["PriceChart_figure"]}>{PriceChart_millions(traded)}</Text>
          </StackLayout>
        </GridLayout>

        <StackLayout gap={1}>
          <svg viewBox={`0 0 ${PriceChart_WIDTH} ${PriceChart_HEIGHT}`} role="img" aria-label={`${entry.name} price over the session, from ${prices[0]!.toFixed(2)} to ${entry.price.toFixed(2)}, with volume bars`} className={styles["PriceChart_chart"]} data-demo-anchor="price-chart">
            <g stroke="var(--salt-separable-tertiary-borderColor)">
              <line x1={0} x2={PriceChart_WIDTH} y1={PriceChart_PAD} y2={PriceChart_PAD} vectorEffect="non-scaling-stroke" />
              <line x1={0} x2={PriceChart_WIDTH} y1={PriceChart_PRICE_BASE} y2={PriceChart_PRICE_BASE} vectorEffect="non-scaling-stroke" />
              <line x1={0} x2={PriceChart_WIDTH} y1={PriceChart_HEIGHT} y2={PriceChart_HEIGHT} vectorEffect="non-scaling-stroke" />
            </g>
            <path d={area} fill={color} fillOpacity={0.16} stroke="none" />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <g fill="var(--salt-sentiment-neutral-dataviz)">
              {volumes.map((volume, index) => {
                const height = ((PriceChart_HEIGHT - PriceChart_VOLUME_TOP) * volume) / peak;
                return <rect key={index} x={x(index) - step * 0.35} y={PriceChart_HEIGHT - height} width={step * 0.7} height={height} />;
              })}
            </g>
          </svg>
          <FlexLayout justify="space-between" gap={1}>
            <Text styleAs="label" color="secondary">{`${SESSION.open} ET`}</Text>
            <Text styleAs="label" color="secondary">{`${SESSION.latest} ET`}</Text>
          </FlexLayout>
        </StackLayout>

        <Text color="secondary">{`Over the session, ${entry.symbol} moved from USD ${prices[0]!.toFixed(2)} to USD ${entry.price.toFixed(2)} on ${PriceChart_millions(traded)} shares, between a low of ${low.toFixed(2)} and a high of ${high.toFixed(2)}.`}</Text>
      </StackLayout>
    </Panel>
  );
}

const TradeBlotter_AWAITING = "Awaiting allocation";

const TradeBlotter_shares = (quantity: number) => quantity.toLocaleString("en-US");

const TradeBlotter_usd = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TradeBlotter_millions = (value: number) => `USD ${(value / 1_000_000).toFixed(2)}M`;

function TradeBlotter_Figure({ label, value, detail, live }: { label: string; value: string; detail: string; live?: boolean }) {
  return (
    <StackLayout gap={1}>
      <Text styleAs="label" color="secondary">
        {label}
      </Text>
      <Display3 className={styles["TradeBlotter_figure"]}>{value}</Display3>
      <Text styleAs="label" color="secondary" role={live ? "status" : undefined}>
        {detail}
      </Text>
    </StackLayout>
  );
}

function TradeBlotter() {
  const approver = useProfile().persona === "Approver";
  const [allocated, setAllocated] = useState<readonly string[]>([]);
  const [recalculated, setRecalculated] = useState(false);
  const statusOf = (trade: (typeof TRADES)[number]) => (allocated.includes(trade.id) ? "Allocated" : trade.status);
  const awaiting = TRADES.filter((trade) => statusOf(trade) === TradeBlotter_AWAITING).length;

  return (
    <Panel data-demo-anchor="blotter-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <H2>Trade blotter</H2>
          <Button sentiment="neutral" appearance="bordered" onClick={() => setRecalculated(true)} data-demo-anchor="recalculate-exposure">
            <RefreshIcon aria-hidden />
            Recalculate exposure
          </Button>
        </FlexLayout>

        <GridLayout columns={{ xs: 1, sm: 3 }} gap={2}>
          <TradeBlotter_Figure label="Awaiting allocation" value={`${awaiting}`} detail="Approver allocates" />
          <TradeBlotter_Figure label="Gross exposure" value={TradeBlotter_millions(recalculated ? EXPOSURE.recalculated : EXPOSURE.calculated)} detail={recalculated ? `Recalculated at ${EXPOSURE.recalculatedAt}` : `Calculated at ${EXPOSURE.at}`} live />
          <TradeBlotter_Figure label="Trades today" value={`${TRADES.length}`} detail="Since the 09:30 ET open" />
        </GridLayout>

        <TableContainer>
          <Table aria-label="Trades">
            <THead sticky>
              <TR>
                <TH>Trade</TH>
                <TH>Time</TH>
                <TH>Symbol</TH>
                <TH>Side</TH>
                <TH textAlign="right">Quantity</TH>
                <TH textAlign="right">Price (USD)</TH>
                <TH textAlign="right">Notional (USD)</TH>
                <TH>Status</TH>
                {approver && <TH>Allocation</TH>}
              </TR>
            </THead>
            <TBody>
              {TRADES.map((trade) => {
                const status = statusOf(trade);
                const waiting = status === TradeBlotter_AWAITING;
                return (
                  <TR key={trade.id} data-demo-anchor={`trade-${trade.id}`}>
                    <TD>
                      <Text fontWeight="bolder">{trade.id}</Text>
                    </TD>
                    <TD>
                      <Text styleAs="label" color="secondary">
                        {trade.time}
                      </Text>
                    </TD>
                    <TD>{trade.symbol}</TD>
                    <TD>{trade.side}</TD>
                    <TD textAlign="right" className={styles["TradeBlotter_figure"]}>
                      {TradeBlotter_shares(trade.quantity)}
                    </TD>
                    <TD textAlign="right" className={styles["TradeBlotter_figure"]}>
                      {TradeBlotter_usd(trade.price)}
                    </TD>
                    <TD textAlign="right" className={styles["TradeBlotter_figure"]}>
                      {TradeBlotter_usd(trade.quantity * trade.price)}
                    </TD>
                    <TD>
                      <FlexLayout gap={1} align="center" wrap={false}>
                        <StatusIndicator status={waiting ? "warning" : "success"} />
                        <Text>{status}</Text>
                      </FlexLayout>
                    </TD>
                    {approver && (
                      <TD>
                        {waiting ? (
                          <Button sentiment="accented" appearance="transparent" onClick={() => setAllocated((ids) => [...ids, trade.id])} data-demo-anchor={`approve-${trade.id}`}>
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
    </Panel>
  );
}

export default function MarketWatch() {
  return (
    <GridLayout columns={{ xs: 1, md: 3 }} gap={3}>
      <GridItem colSpan={{ xs: 1, md: 2 }}>
        <Watchlist />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 1 }}>
        <OrderTicket />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 3 }}>
        <PriceChart />
      </GridItem>
      <GridItem colSpan={{ xs: 1, md: 3 }}>
        <TradeBlotter />
      </GridItem>
    </GridLayout>
  );
}
