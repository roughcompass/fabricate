import { useState } from "react";
import { FlexLayout, H2, Label, Panel, StackLayout, Text } from "@salt-ds/core";
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

export default function PriceChart() {
  const [symbol, setSymbol] = useState(INSTRUMENTS[0]!.symbol);
  useBus("instrument:selected", MEMBER, (payload: unknown) => {
    const next = (payload as { symbol?: unknown })?.symbol;
    if (typeof next === "string" && instrument(next)) setSymbol(next);
  });

  const entry = instrument(symbol)!;
  const values = series(symbol);
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
              <strong>{formatChange(entry.change)}</strong>
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
