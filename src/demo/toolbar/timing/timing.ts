/**
 * The timing tool's model (template-demo/toolbar spec): interaction ratings,
 * the load waterfall, hot-spot costs, and Web Vitals. No React or browser
 * dependencies, so the rules can be tested directly.
 */

export type Rating = "good" | "needs-improvement" | "poor";

export const RATING_LABELS: Record<Rating, string> = { good: "Good", "needs-improvement": "Needs improvement", poor: "Poor" };

/** Input to next paint: good at 200 ms or less, poor above 500 ms. */
export function rate(durationMs: number): Rating {
  return rateVital("INP", durationMs);
}

export interface Interaction {
  readonly id: number;
  readonly kind: "Click" | "Tap" | "Key press";
  /** The element the visitor used, described for people: `button "Recalculate totals"`. */
  readonly target: string;
  readonly member: string;
  readonly durationMs: number;
  /** Measured to the next frame after the handlers, because the browser lacks Event Timing. */
  readonly approximate: boolean;
}

export interface WaterfallLoad {
  readonly member: string;
  readonly version: string;
  /** When the load began, from the start of the route. */
  readonly startMs: number;
  /** Measured until the member painted; null while it is still loading. */
  readonly durationMs: number | null;
  readonly kind: "load" | "swap";
  /** For a swap, the version it replaced. */
  readonly from?: string;
}

export interface WaterfallRow extends WaterfallLoad {
  readonly slowest: boolean;
  /** Bar position as fractions of the whole waterfall. */
  readonly offset: number;
  readonly width: number;
}

/** The loads in the order they started, the slowest finished one flagged, scaled to the latest finish. */
export function waterfall(loads: readonly WaterfallLoad[]): WaterfallRow[] {
  const end = Math.max(1, ...loads.map((load) => load.startMs + (load.durationMs ?? 0)));
  const slowest = loads.reduce<WaterfallLoad | null>((worst, load) => (load.durationMs !== null && (!worst || load.durationMs > worst.durationMs!) ? load : worst), null);
  // A stable sort keeps the script's order for loads that start together.
  return [...loads]
    .map((load, index) => ({ load, index }))
    .sort((left, right) => left.load.startMs - right.load.startMs || left.index - right.index)
    .map(({ load }) => ({ ...load, slowest: load === slowest, offset: load.startMs / end, width: Math.max((load.durationMs ?? 0) / end, 0.01) }));
}

export function slowestInteraction(interactions: readonly Interaction[]): Interaction | null {
  return interactions.reduce<Interaction | null>((worst, interaction) => (!worst || interaction.durationMs > worst.durationMs ? interaction : worst), null);
}

export interface HotSpot {
  readonly member: string;
  readonly loadMs: number;
  readonly interactionMs: number;
  readonly costMs: number;
  /** How the region is tinted: the costliest is high; others by their share of it. */
  readonly level: "high" | "medium" | "low";
}

/**
 * Each member's cost: its latest load's duration plus its slowest interaction,
 * costliest first. Only `members` (the regions on the page) are ranked.
 */
export function hotSpots(members: readonly string[], loads: readonly WaterfallLoad[], interactions: readonly Interaction[]): HotSpot[] {
  const spots = members.map((member) => {
    const memberLoads = loads.filter((load) => load.member === member);
    const loadMs = memberLoads.at(-1)?.durationMs ?? 0;
    const interactionMs = Math.max(0, ...interactions.filter((interaction) => interaction.member === member).map((interaction) => interaction.durationMs));
    return { member, loadMs, interactionMs, costMs: loadMs + interactionMs };
  });
  spots.sort((left, right) => right.costMs - left.costMs || members.indexOf(left.member) - members.indexOf(right.member));
  const top = spots[0]?.costMs ?? 0;
  return spots.map((spot, index) => ({ ...spot, level: index === 0 && top > 0 ? "high" : top > 0 && spot.costMs / top >= 0.5 ? "medium" : "low" }));
}

export function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString("en-US")} ms`;
}

/**
 * Interaction to Next Paint over the given interactions: the slowest, less one
 * outlier for every 50, as browsers report it. Null before any interaction.
 */
export function interactionToNextPaint(interactions: readonly Interaction[]): number | null {
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
