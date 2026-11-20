/**
 * The timing tool's model (template-demo/toolbar spec): interaction ratings,
 * the load waterfall, and Web Vitals' thresholds. No React or browser
 * dependencies, so the rules can be tested directly.
 */

import { formatNumber } from "@/components/ui/count";

export type Rating = "good" | "needs-improvement" | "poor";

export const RATING_LABELS: Record<Rating, string> = { good: "Good", "needs-improvement": "Needs improvement", poor: "Poor" };

/** Input to next paint: good at 200 ms or less, poor above 500 ms. */
export function rate(durationMs: number): Rating {
  return rateVital("INP", durationMs);
}

/** An interaction's duration, from input to the next paint. */
interface Timed {
  readonly durationMs: number;
}

/** What a waterfall row needs: when a load began, and how long it took, or null while it's still loading. */
interface Started {
  readonly startMs: number;
  readonly durationMs: number | null;
}

type WaterfallRow<L extends Started> = L & {
  readonly slowest: boolean;
  /** Bar position as fractions of the whole waterfall. */
  readonly offset: number;
  readonly width: number;
};

/** The loads in the order they started, the slowest finished one flagged, scaled to the latest finish. */
export function waterfall<L extends Started>(loads: readonly L[]): WaterfallRow<L>[] {
  const end = Math.max(1, ...loads.map((load) => load.startMs + (load.durationMs ?? 0)));
  const slowest = loads.reduce<L | null>((worst, load) => (load.durationMs !== null && (!worst || load.durationMs > worst.durationMs!) ? load : worst), null);
  // A stable sort keeps the reported order for loads that start together.
  return [...loads]
    .map((load, index) => ({ load, index }))
    .sort((left, right) => left.load.startMs - right.load.startMs || left.index - right.index)
    .map(({ load }) => ({ ...load, slowest: load === slowest, offset: load.startMs / end, width: Math.max((load.durationMs ?? 0) / end, 0.01) }));
}

export function slowestInteraction<I extends Timed>(interactions: readonly I[]): I | null {
  return interactions.reduce<I | null>((worst, interaction) => (!worst || interaction.durationMs > worst.durationMs ? interaction : worst), null);
}

export function formatMs(ms: number): string {
  return `${formatNumber(Math.round(ms))} ms`;
}

/**
 * Interaction to Next Paint over the given interactions: the slowest, less one
 * outlier for every 50, as browsers report it. Null before any interaction.
 */
export function interactionToNextPaint(interactions: readonly Timed[]): number | null {
  if (!interactions.length) return null;
  const durations = interactions.map((interaction) => interaction.durationMs).sort((left, right) => right - left);
  return durations[Math.min(durations.length - 1, Math.floor(durations.length / 50))]!;
}

export type VitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";

export const VITALS: readonly { readonly name: VitalName; readonly title: string; readonly description: string; readonly good: number; readonly poor: number }[] = [
  { name: "LCP", title: "Largest Contentful Paint", description: "When the largest text or image on the page painted.", good: 2500, poor: 4000 },
  { name: "INP", title: "Interaction to Next Paint", description: "How quickly the page responds to clicks, taps, and key presses: the application's, not the toolbar's.", good: 200, poor: 500 },
  { name: "CLS", title: "Cumulative Layout Shift", description: "How much content moved unexpectedly while the page was in use.", good: 0.1, poor: 0.25 },
  { name: "FCP", title: "First Contentful Paint", description: "When the first text or image painted.", good: 1800, poor: 3000 },
  { name: "TTFB", title: "Time to First Byte", description: "When the first byte of the page's response arrived.", good: 800, poor: 1800 },
];

/** A vital's rating at the published thresholds: good at or under the first, poor above the second. */
export function rateVital(name: VitalName, value: number): Rating {
  const { good, poor } = VITALS.find((vital) => vital.name === name)!;
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

/** Layout shift is a unitless score; the rest are milliseconds. */
export function formatVital(name: VitalName, value: number): string {
  return name === "CLS" ? value.toFixed(2) : formatMs(value);
}
