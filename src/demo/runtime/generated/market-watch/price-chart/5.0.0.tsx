import { useBus } from "@deweb/portal";
import { Display3, FlexLayout, GridLayout, H2, Panel, StackLayout, Text, ToggleButton, ToggleButtonGroup, useResponsiveProp } from "@salt-ds/core";
import { ArrowDownIcon, ArrowUpIcon } from "@salt-ds/icons";
import { type SyntheticEvent, useState } from "react";
import { INSTRUMENTS, SESSION } from "../data";
import styles from "./5.0.0.module.css";

const MEMBER = "price-chart";
const POINTS = 32;
const WIDTH = 720;
const HEIGHT = 200;
const PAD = 12;

const instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);
const signed = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(Math.round(total % 60)).padStart(2, "0")} ET`;
/** The time of a point in the session, from the open to the latest. */
const timeOf = (index: number) => clock(minutes(SESSION.open) + ((minutes(SESSION.latest) - minutes(SESSION.open)) * index) / (POINTS - 1));

/** A deterministic price series for a symbol, so the chart is the same on every visit. */
function series(symbol: string): number[] {
  const base = instrument(symbol)?.price ?? 100;
  let seed = [...symbol].reduce((total, char) => total * 31 + char.charCodeAt(0), 7) % 2147483648;
  const open = base * (1 - (instrument(symbol)?.change ?? 0) / 100);
  const values: number[] = [];
  for (let index = 0; index < POINTS; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const trend = open + ((base - open) * index) / (POINTS - 1);
    const noise = index === 0 || index === POINTS - 1 ? 0 : (seed / 2147483648 - 0.5) * base * 0.01;
    values.push(Number((trend + noise).toFixed(2)));
  }
  return values;
}

const RANGES = [
  { value: "full", label: "Full session", fraction: 1, phrase: "the session" },
  { value: "half", label: "Last half", fraction: 0.5, phrase: "the last half of the session" },
  { value: "quarter", label: "Last quarter", fraction: 0.25, phrase: "the last quarter of the session" },
] as const;

type RangeValue = (typeof RANGES)[number]["value"];

export default function PriceChart() {
  const [symbol, setSymbol] = useState(INSTRUMENTS[0]!.symbol);
  const [range, setRange] = useState<RangeValue>("full");
  // The range buttons stack on the narrowest screens, so the region reflows at 320 pixels.
  const orientation = useResponsiveProp<"horizontal" | "vertical">({ xs: "vertical", sm: "horizontal" }, "horizontal");
  useBus("instrument:selected", MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown } | null)?.symbol;
    if (typeof next === "string" && instrument(next)) setSymbol(next);
  });

  const entry = instrument(symbol)!;
  const session = series(symbol);
  const low = Math.min(...session);
  const high = Math.max(...session);

  const selectedRange = RANGES.find((option) => option.value === range) ?? RANGES[0];
  const count = Math.max(2, Math.round(POINTS * selectedRange.fraction));
  const first = POINTS - count;
  const values = session.slice(first);
  const viewLow = Math.min(...values);
  const viewHigh = Math.max(...values);

  const x = (index: number) => (index / (values.length - 1)) * WIDTH;
  const y = (value: number) => PAD + (1 - (value - viewLow) / (viewHigh - viewLow || 1)) * (HEIGHT - PAD * 2);
  const line = values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const positive = entry.change >= 0;
  const ChangeIcon = positive ? ArrowUpIcon : ArrowDownIcon;
  const tone = positive ? "success" : "error";

  const handleRange = (event: SyntheticEvent<HTMLButtonElement>) => {
    const next = event.currentTarget.value as RangeValue;
    if (RANGES.some((option) => option.value === next)) setRange(next);
  };

  return (
    <Panel data-demo-anchor="price-chart-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="baseline" gap={1} wrap>
          <H2>{`Price chart · ${entry.symbol}`}</H2>
          <Text styleAs="label" color="secondary">{`${entry.name}, ${SESSION.date}`}</Text>
        </FlexLayout>

        <GridLayout columns={{ xs: 1, sm: 3 }} gap={2}>
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
              <Text color={tone} fontWeight="bolder" className={styles.figure}>
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
        </GridLayout>

        <ToggleButtonGroup aria-label="Chart range" orientation={orientation} value={range} onChange={handleRange}>
          {RANGES.map((option) => (
            <ToggleButton key={option.value} value={option.value}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <StackLayout gap={1}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${entry.name} price over ${selectedRange.phrase}, from ${values[0]!.toFixed(2)} to ${entry.price.toFixed(2)}`} className={styles.chart} data-demo-anchor="price-chart">
            <g stroke="var(--salt-separable-tertiary-borderColor)">
              <line x1={0} x2={WIDTH} y1={PAD} y2={PAD} vectorEffect="non-scaling-stroke" />
              <line x1={0} x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} vectorEffect="non-scaling-stroke" />
              <line x1={0} x2={WIDTH} y1={HEIGHT - PAD} y2={HEIGHT - PAD} vectorEffect="non-scaling-stroke" />
            </g>
            <path d={line} fill="none" stroke={positive ? "var(--salt-sentiment-positive-dataviz)" : "var(--salt-sentiment-negative-dataviz)"} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <FlexLayout justify="space-between" gap={1}>
            <Text styleAs="label" color="secondary">
              {timeOf(first)}
            </Text>
            <Text styleAs="label" color="secondary">
              {timeOf(POINTS - 1)}
            </Text>
          </FlexLayout>
        </StackLayout>

        <Text color="secondary">{`Over ${selectedRange.phrase}, ${entry.symbol} moved from USD ${values[0]!.toFixed(2)} to USD ${entry.price.toFixed(2)}, between a low of ${viewLow.toFixed(2)} and a high of ${viewHigh.toFixed(2)}.`}</Text>
      </StackLayout>
    </Panel>
  );
}
