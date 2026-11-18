import { useBus } from "@deweb/portal";
import { Display3, FlexLayout, GridLayout, H2, Panel, StackLayout, Text } from "@salt-ds/core";
import { ArrowDownIcon, ArrowUpIcon } from "@salt-ds/icons";
import { useState } from "react";
import { INSTRUMENTS, SESSION } from "../data";
import styles from "./5.1.0.module.css";

const MEMBER = "price-chart";
const POINTS = 32;
const WIDTH = 720;
const HEIGHT = 240;
const PAD = 12;
/** Where the price area ends and the volume band begins. */
const PRICE_BASE = 168;
const VOLUME_TOP = 184;

const instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);
const signed = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
const millions = (shares: number) => `${(shares / 1_000_000).toFixed(2)}M`;

/** A deterministic price and volume series for a symbol, so the chart is the same on every visit. */
function series(symbol: string): { prices: number[]; volumes: number[] } {
  const base = instrument(symbol)?.price ?? 100;
  let seed = [...symbol].reduce((total, char) => total * 31 + char.charCodeAt(0), 7) % 2147483648;
  const open = base * (1 - (instrument(symbol)?.change ?? 0) / 100);
  const prices: number[] = [];
  const volumes: number[] = [];
  for (let index = 0; index < POINTS; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const random = seed / 2147483648;
    const trend = open + ((base - open) * index) / (POINTS - 1);
    const noise = index === 0 || index === POINTS - 1 ? 0 : (random - 0.5) * base * 0.01;
    prices.push(Number((trend + noise).toFixed(2)));
    // Volume is heaviest at the open and tapers through the day.
    volumes.push(Math.round((40_000 + random * 90_000) * (index < 4 ? 2.2 - index * 0.3 : 1)));
  }
  return { prices, volumes };
}

export default function PriceChart() {
  const [symbol, setSymbol] = useState(INSTRUMENTS[0]!.symbol);
  useBus("instrument:selected", MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown } | null)?.symbol;
    if (typeof next === "string" && instrument(next)) setSymbol(next);
  });

  const entry = instrument(symbol)!;
  const { prices, volumes } = series(symbol);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const peak = Math.max(...volumes);
  const traded = volumes.reduce((total, volume) => total + volume, 0);

  const step = WIDTH / POINTS;
  const x = (index: number) => step * index + step / 2;
  const y = (value: number) => PAD + (1 - (value - low) / (high - low || 1)) * (PRICE_BASE - PAD * 2);
  const line = prices.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(POINTS - 1).toFixed(1)},${PRICE_BASE} L${x(0).toFixed(1)},${PRICE_BASE} Z`;
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
            <Display3 className={styles.figure}>{entry.price.toFixed(2)}</Display3>
          </StackLayout>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              Change on the day
            </Text>
            <FlexLayout gap={1} align="center">
              <ChangeIcon aria-hidden />
              <Text color={positive ? "success" : "error"} fontWeight="bolder" className={styles.figure}>
                {signed(entry.change)}
              </Text>
            </FlexLayout>
          </StackLayout>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              Day range (USD)
            </Text>
            <Text className={styles.figure}>{`${low.toFixed(2)} – ${high.toFixed(2)}`}</Text>
          </StackLayout>
          <StackLayout gap={1}>
            <Text styleAs="label" color="secondary">
              Volume (shares)
            </Text>
            <Text className={styles.figure}>{millions(traded)}</Text>
          </StackLayout>
        </GridLayout>

        <StackLayout gap={1}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${entry.name} price over the session, from ${prices[0]!.toFixed(2)} to ${entry.price.toFixed(2)}, with volume bars`} className={styles.chart} data-demo-anchor="price-chart">
            <g stroke="var(--salt-separable-tertiary-borderColor)">
              <line x1={0} x2={WIDTH} y1={PAD} y2={PAD} vectorEffect="non-scaling-stroke" />
              <line x1={0} x2={WIDTH} y1={PRICE_BASE} y2={PRICE_BASE} vectorEffect="non-scaling-stroke" />
              <line x1={0} x2={WIDTH} y1={HEIGHT} y2={HEIGHT} vectorEffect="non-scaling-stroke" />
            </g>
            <path d={area} fill={color} fillOpacity={0.16} stroke="none" />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <g fill="var(--salt-sentiment-neutral-dataviz)">
              {volumes.map((volume, index) => {
                const height = ((HEIGHT - VOLUME_TOP) * volume) / peak;
                return <rect key={index} x={x(index) - step * 0.35} y={HEIGHT - height} width={step * 0.7} height={height} />;
              })}
            </g>
          </svg>
          <FlexLayout justify="space-between" gap={1}>
            <Text styleAs="label" color="secondary">{`${SESSION.open} ET`}</Text>
            <Text styleAs="label" color="secondary">{`${SESSION.latest} ET`}</Text>
          </FlexLayout>
        </StackLayout>

        <Text color="secondary">{`Over the session, ${entry.symbol} moved from USD ${prices[0]!.toFixed(2)} to USD ${entry.price.toFixed(2)} on ${millions(traded)} shares, between a low of ${low.toFixed(2)} and a high of ${high.toFixed(2)}.`}</Text>
      </StackLayout>
    </Panel>
  );
}
