/**
 * The timing tool's model (template-demo/toolbar spec): interaction ratings,
 * the load waterfall, and hot-spot costs. No React or browser dependencies,
 * so the rules can be tested directly.
 */

export type Rating = "good" | "needs-improvement" | "poor";

export const RATING_LABELS: Record<Rating, string> = { good: "Good", "needs-improvement": "Needs improvement", poor: "Poor" };

/** Input to next paint: good at 200 ms or less, poor above 500 ms. */
export function rate(durationMs: number): Rating {
  if (durationMs <= 200) return "good";
  if (durationMs <= 500) return "needs-improvement";
  return "poor";
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
  readonly startMs: number;
  readonly durationMs: number;
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

/** The loads in the order they started, the slowest flagged, scaled to the latest finish. */
export function waterfall(loads: readonly WaterfallLoad[]): WaterfallRow[] {
  const end = Math.max(1, ...loads.map((load) => load.startMs + load.durationMs));
  const slowest = loads.reduce<WaterfallLoad | null>((worst, load) => (!worst || load.durationMs > worst.durationMs ? load : worst), null);
  // A stable sort keeps the script's order for loads that start together.
  return [...loads]
    .map((load, index) => ({ load, index }))
    .sort((left, right) => left.load.startMs - right.load.startMs || left.index - right.index)
    .map(({ load }) => ({ ...load, slowest: load === slowest, offset: load.startMs / end, width: Math.max(load.durationMs / end, 0.01) }));
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
    const loadMs = memberLoads.length ? memberLoads[memberLoads.length - 1]!.durationMs : 0;
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
