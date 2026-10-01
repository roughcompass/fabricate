"use client";

import { useState } from "react";
import { useBusSubscription, usePersona, usePublish } from "../runtime-context";
import { Icon } from "./icons";
import { blockMainThread } from "./planted";
import { Badge, Button, Field, Muted, Panel, Select, Stat, Table, Td, TextInput, Th, Tr, uiStyles } from "./ui";
import styles from "./markets.module.css";

/** The Market watch hero: watchlist, order ticket, price chart, and trade blotter. */

interface Instrument {
  symbol: string;
  name: string;
  price: number;
  change: number;
}

export const INSTRUMENTS: readonly Instrument[] = [
  { symbol: "ACME", name: "Acme Corp", price: 182.4, change: 1.84 },
  { symbol: "GLBX", name: "Globex Holdings", price: 64.12, change: -0.92 },
  { symbol: "INIT", name: "Initech Systems", price: 41.07, change: 0.35 },
  { symbol: "UMBR", name: "Umbrella Health", price: 219.55, change: -2.11 },
  { symbol: "STRK", name: "Stark Industrial", price: 97.3, change: 3.02 },
  { symbol: "WAYN", name: "Wayne Logistics", price: 128.66, change: 0.08 },
];

const instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);
const formatChange = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;

function useSelectedSymbol(member: string): string {
  const [symbol, setSymbol] = useState(INSTRUMENTS[0]!.symbol);
  useBusSubscription("instrument:selected", member, (payload) => {
    const next = (payload as { symbol?: unknown })?.symbol;
    if (typeof next === "string" && instrument(next)) setSymbol(next);
  });
  return symbol;
}

function useWatchlist() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(INSTRUMENTS[0]!.symbol);
  const publish = usePublish("watchlist");
  const rows = INSTRUMENTS.filter((entry) => `${entry.symbol} ${entry.name}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const choose = (entry: Instrument) => {
    setSelected(entry.symbol);
    publish("instrument:selected", { symbol: entry.symbol, name: entry.name });
  };
  return { filter, setFilter, selected, rows, choose };
}

/**
 * PLANTED DEFECTS (watchlist 1.8.0): the filter has no label, the instrument
 * names use the deliberately faint token, and the chart buttons have no
 * accessible name. Version 1.9.0 fixes all three.
 */
export function Watchlist180() {
  const { filter, setFilter, selected, rows, choose } = useWatchlist();
  return (
    <Panel title="Watchlist" anchor="watchlist-panel">
      <p className={uiStyles.muted}>Filter symbols</p>
      <input className={uiStyles.input} value={filter} onChange={(event) => setFilter(event.currentTarget.value)} data-demo-anchor="watchlist-filter" />
      <Table label="Watchlist" head={<><Th>Symbol</Th><Th numeric>Last</Th><Th numeric>Change</Th><Th /></>}>
        {rows.map((entry) => (
          <Tr key={entry.symbol} selected={selected === entry.symbol} anchor={`instrument-${entry.symbol}`}>
            <Td>
              <strong>{entry.symbol}</strong> <span className={uiStyles.defectFaint}>{entry.name}</span>
            </Td>
            <Td numeric>{entry.price.toFixed(2)}</Td>
            <Td numeric>
              <Badge tone={entry.change >= 0 ? "positive" : "negative"}>{formatChange(entry.change)}</Badge>
            </Td>
            <Td>
              <button type="button" className={[uiStyles.button, uiStyles.ghost].join(" ")} onClick={() => choose(entry)} data-demo-anchor={`chart-${entry.symbol}`}>
                <Icon name="trend" />
              </button>
            </Td>
          </Tr>
        ))}
      </Table>
    </Panel>
  );
}

export function Watchlist190() {
  const { filter, setFilter, selected, rows, choose } = useWatchlist();
  return (
    <Panel title="Watchlist" anchor="watchlist-panel">
      <Field id="watchlist-filter" label="Filter symbols">
        <TextInput id="watchlist-filter" placeholder="Symbol or name" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} anchor="watchlist-filter" />
      </Field>
      <Table label="Watchlist" head={<><Th>Symbol</Th><Th numeric>Last</Th><Th numeric>Change</Th><Th>Chart</Th></>}>
        {rows.map((entry) => (
          <Tr key={entry.symbol} selected={selected === entry.symbol} anchor={`instrument-${entry.symbol}`}>
            <Td>
              <strong>{entry.symbol}</strong> <span className={uiStyles.muted}>{entry.name}</span>
            </Td>
            <Td numeric>{entry.price.toFixed(2)}</Td>
            <Td numeric>
              <Badge tone={entry.change >= 0 ? "positive" : "negative"}>{formatChange(entry.change)}</Badge>
            </Td>
            <Td>
              <Button variant="ghost" onClick={() => choose(entry)} anchor={`chart-${entry.symbol}`} aria-label={`Chart ${entry.symbol}`}>
                <Icon name="trend" />
                Chart
              </Button>
            </Td>
          </Tr>
        ))}
      </Table>
    </Panel>
  );
}

export function Watchlist200Beta() {
  const { filter, setFilter, selected, rows, choose } = useWatchlist();
  return (
    <Panel title="Watchlist" anchor="watchlist-panel" actions={<Badge tone="accent">Preview: price tiles</Badge>}>
      <Field id="watchlist-filter-beta" label="Filter symbols">
        <TextInput id="watchlist-filter-beta" placeholder="Symbol or name" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} anchor="watchlist-filter" />
      </Field>
      <ul className={styles.tiles}>
        {rows.map((entry) => (
          <li key={entry.symbol}>
            <button type="button" className={[styles.tile, selected === entry.symbol && styles.tileSelected].filter(Boolean).join(" ")} onClick={() => choose(entry)} data-demo-anchor={`instrument-${entry.symbol}`} aria-pressed={selected === entry.symbol}>
              <span className={styles.tileSymbol}>{entry.symbol}</span>
              <span className={styles.tilePrice}>{entry.price.toFixed(2)}</span>
              <span className={entry.change >= 0 ? uiStyles.positive : uiStyles.negative}>{formatChange(entry.change)}</span>
              <span className={styles.bar} data-direction={entry.change >= 0 ? "up" : "down"} style={{ inlineSize: `${Math.min(100, Math.abs(entry.change) * 30)}%` }} />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function OrderTicket() {
  const symbol = useSelectedSymbol("order-ticket");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const entry = instrument(symbol)!;
  return (
    <Panel title="Order ticket" anchor="order-panel">
      <form
        className={uiStyles.stack}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setSubmitted(`${data.get("side") === "sell" ? "Sell" : "Buy"} ${data.get("quantity") || 0} ${symbol} at ${data.get("type") === "market" ? "market" : `limit ${data.get("limit") || entry.price.toFixed(2)}`} submitted.`);
        }}
      >
        <p className={styles.ticketSymbol} data-demo-anchor="order-symbol">
          {`${entry.symbol} · ${entry.name}`}
        </p>
        <Field id="order-side" label="Side">
          <Select id="order-side" name="side" defaultValue="buy" anchor="order-side">
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </Select>
        </Field>
        <Field id="order-type" label="Order type">
          <Select id="order-type" name="type" defaultValue="limit" anchor="order-type">
            <option value="limit">Limit</option>
            <option value="market">Market</option>
          </Select>
        </Field>
        <Field id="order-quantity" label="Quantity">
          <TextInput id="order-quantity" name="quantity" inputMode="numeric" placeholder="100" anchor="order-quantity" />
        </Field>
        <Field id="order-limit" label="Limit price">
          <TextInput id="order-limit" name="limit" inputMode="decimal" placeholder={entry.price.toFixed(2)} anchor="order-limit" />
        </Field>
        <Button variant="primary" type="submit" anchor="submit-order">
          Submit order
        </Button>
        <p role="status" className={uiStyles.muted}>
          {submitted ?? ""}
        </p>
      </form>
    </Panel>
  );
}

/** A deterministic price series for a symbol, so the chart is the same on every visit. */
export function series(symbol: string, points = 32): number[] {
  const base = instrument(symbol)?.price ?? 100;
  let seed = [...symbol].reduce((total, char) => total * 31 + char.charCodeAt(0), 7) % 2147483648;
  const open = base * (1 - (instrument(symbol)?.change ?? 0) / 100);
  const values: number[] = [];
  for (let index = 0; index < points; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const trend = open + ((base - open) * index) / (points - 1);
    const noise = index === 0 || index === points - 1 ? 0 : ((seed / 2147483648) - 0.5) * base * 0.01;
    values.push(Number((trend + noise).toFixed(2)));
  }
  return values;
}

function PriceChart({ area }: { area: boolean }) {
  const symbol = useSelectedSymbol("price-chart");
  const entry = instrument(symbol)!;
  const values = series(symbol);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index: number) => (index / (values.length - 1)) * 600;
  const y = (value: number) => 150 - ((value - min) / (max - min || 1)) * 130;
  const line = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return (
    <Panel title={`Price chart · ${entry.symbol}`} anchor="price-chart-panel" actions={<Badge tone={entry.change >= 0 ? "positive" : "negative"}>{formatChange(entry.change)}</Badge>}>
      <div className={styles.chartStats}>
        <Stat label="Last" value={entry.price.toFixed(2)} />
        <Stat label="Day range" value={`${min.toFixed(2)} – ${max.toFixed(2)}`} />
      </div>
      <svg className={styles.chart} viewBox="0 0 600 180" preserveAspectRatio="none" role="img" aria-label={`${entry.name} price over the session, from ${values[0]!.toFixed(2)} to ${entry.price.toFixed(2)}`} data-demo-anchor="price-chart">
        {area && <path d={`${line} L600,170 L0,170 Z`} className={styles.area} />}
        {area &&
          values.map((value, index) => (
            <rect key={index} x={x(index) - 4} y={170 - ((index * 7 + value) % 22)} width={8} height={(index * 7 + value) % 22} className={styles.volume} />
          ))}
        <path d={line} className={styles.line} />
      </svg>
      <Muted>{area ? "Area chart with volume bars." : "Line chart for the current session."}</Muted>
    </Panel>
  );
}

const TRADES = [
  { id: "T-8812", symbol: "ACME", side: "Buy", quantity: "1,200", price: "181.95", status: "Filled" },
  { id: "T-8813", symbol: "UMBR", side: "Sell", quantity: "400", price: "220.10", status: "Awaiting allocation" },
  { id: "T-8814", symbol: "STRK", side: "Buy", quantity: "2,500", price: "96.80", status: "Awaiting allocation" },
  { id: "T-8815", symbol: "GLBX", side: "Sell", quantity: "900", price: "64.40", status: "Filled" },
] as const;

export function TradeBlotter() {
  const persona = usePersona();
  const approver = persona.role === "Approver";
  const [allocated, setAllocated] = useState<readonly string[]>([]);
  const [exposure, setExposure] = useState("$1.42M");
  return (
    <Panel
      title="Trade blotter"
      anchor="blotter-panel"
      actions={
        <Button
          onClick={() => {
            blockMainThread(650);
            setExposure("$1.43M");
          }}
          anchor="recalculate-exposure"
        >
          <Icon name="refresh" />
          Recalculate exposure
        </Button>
      }
    >
      <div className={uiStyles.stats}>
        <Stat label="Gross exposure" value={exposure} />
        <Stat label="Trades today" value="4" />
        <Stat label="Awaiting allocation" value={`${2 - allocated.length}`} tone="accent" detail="Approver allocates" />
      </div>
      <Table label="Trades" head={<><Th>Trade</Th><Th>Symbol</Th><Th>Side</Th><Th numeric>Quantity</Th><Th numeric>Price</Th><Th>Status</Th>{approver && <Th>Allocation</Th>}</>}>
        {TRADES.map((trade) => {
          const status = allocated.includes(trade.id) ? "Allocated" : trade.status;
          return (
            <Tr key={trade.id} anchor={`trade-${trade.id}`}>
              <Td>{trade.id}</Td>
              <Td>{trade.symbol}</Td>
              <Td>{trade.side}</Td>
              <Td numeric>{trade.quantity}</Td>
              <Td numeric>{trade.price}</Td>
              <Td>
                <Badge tone={status === "Awaiting allocation" ? "accent" : "positive"}>{status}</Badge>
              </Td>
              {approver && (
                <Td>
                  {status === "Awaiting allocation" ? (
                    <Button variant="primary" onClick={() => setAllocated((ids) => [...ids, trade.id])} anchor={`approve-${trade.id}`}>
                      {`Approve ${trade.id}`}
                    </Button>
                  ) : (
                    <span className={uiStyles.muted}>None needed</span>
                  )}
                </Td>
              )}
            </Tr>
          );
        })}
      </Table>
      {!approver && <Muted>Allocations are approved by the Approver role.</Muted>}
    </Panel>
  );
}

export const MARKETS_MEMBERS = {
  watchlist: { "1.8.0": Watchlist180, "1.9.0": Watchlist190, "2.0.0-beta.2": Watchlist200Beta },
  "order-ticket": { "2.2.0": OrderTicket },
  "price-chart": { "5.0.0": () => <PriceChart area={false} />, "5.1.0": () => <PriceChart area /> },
  "trade-blotter": { "3.5.0": TradeBlotter },
} as const;
