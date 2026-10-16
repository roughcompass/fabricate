import { useState, type SyntheticEvent } from "react";
import { FlexLayout, H2, Label, Panel, StackLayout, Text, ToggleButton, ToggleButtonGroup } from "@salt-ds/core";
import { ArrowDownIcon, ArrowUpIcon } from "@salt-ds/icons";
import { useBus } from "@deweb/portal";
import { INSTRUMENTS } from "../data";

const MEMBER = "price-chart";

const instrument = (symbol: string) => INSTRUMENTS.find((entry) => entry.symbol === symbol);
const formatChange = (change: number) => `${change > 0 ? "+" : ""}${change.toFixed(2)}%`;

/** A deterministic price series for a symbol, so the chart is the same on every visit. */
function series(symbol: string, points = 32): number[] {
  const base = instrument(symbol)?.price ?? 100;
  let seed = [...symbol].reduce((total, char) => total * 31 + char.charCodeAt(0), 7) % 2147483648;
  const open = base * (1 - (instrument(symbol)?.change ?? 0) / 100);
  const values: number[] = [];
  for (let index = 0; index < points; index++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const trend = open + ((base - open) * index) / (points - 1);
    const noise = index === 0 || index === points - 1 ? 0 : (seed / 2147483648 - 0.5) * base * 0.01;
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
  useBus("instrument:selected", MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown })?.symbol;
    if (typeof next === "string" && instrument(next)) setSymbol(next);
  });

  const entry = instrument(symbol)!;
  const session = series(symbol);
  const min = Math.min(...session);
  const max = Math.max(...session);

  const selectedRange = RANGES.find((option) => option.value === range) ?? RANGES[0];
  const count = Math.max(2, Math.round(session.length * selectedRange.fraction));
  const values = session.slice(session.length - count);
  const viewMin = Math.min(...values);
  const viewMax = Math.max(...values);

  const x = (index: number) => (index / (values.length - 1)) * 600;
  const y = (value: number) => 150 - ((value - viewMin) / (viewMax - viewMin || 1)) * 130;
  const line = values
    .map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
    .join(" ");
  const positive = entry.change >= 0;
  const ChangeIcon = positive ? ArrowUpIcon : ArrowDownIcon;
  const lineColor = positive ? "var(--salt-sentiment-positive-foreground-informative)" : "var(--salt-sentiment-negative-foreground-informative)";

  const handleRange = (event: SyntheticEvent<HTMLButtonElement>) => {
    const next = event.currentTarget.value as RangeValue;
    if (RANGES.some((option) => option.value === next)) setRange(next);
  };

  return (
    <Panel data-demo-anchor="price-chart-panel">
      <StackLayout gap={2}>
        <FlexLayout justify="space-between" align="center" gap={2} wrap>
          <H2>{`Price chart · ${entry.symbol}`}</H2>
          <FlexLayout gap={1} align="center">
            <ChangeIcon aria-hidden />
            <Text color={positive ? "success" : "error"}>
              <strong>{formatChange(entry.change)}</strong>
            </Text>
          </FlexLayout>
        </FlexLayout>

        <FlexLayout justify="space-between" align="end" gap={3} wrap>
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
          <ToggleButtonGroup aria-label="Chart range" value={range} onChange={handleRange}>
            {RANGES.map((option) => (
              <ToggleButton key={option.value} value={option.value}>
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </FlexLayout>

        <svg
          viewBox="0 0 600 180"
          preserveAspectRatio="none"
          role="img"
          width="100%"
          aria-label={`${entry.name} price over ${selectedRange.phrase}, from ${values[0]!.toFixed(2)} to ${entry.price.toFixed(2)}`}
          data-demo-anchor="price-chart"
          style={{
            blockSize: "calc(var(--salt-size-base) * 7)",
            display: "block",
            borderBottomWidth: "var(--salt-size-border)",
            borderBottomStyle: "solid",
            borderBottomColor: "var(--salt-separable-secondary-borderColor)",
          }}
        >
          <path d={line} fill="none" stroke={lineColor} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>

        <Text color="secondary">Line chart for the current session.</Text>
      </StackLayout>
    </Panel>
  );
}
