import { type AnchorElement, type ElementAnchor, findAnchored } from "../comments/element-anchor";
import { RATING_LABELS, type Rating, formatMs, rate } from "./timing";

/*
 * Timing's hot spots (restore-toolbar-tools-and-branch-previews, design
 * decision 10): the elements behind the page's slow interactions, ranked by
 * each one's slowest. They use the ratings Timing already gives
 * interactions, so only those over 200 ms, Needs improvement or Poor, make
 * a hot spot. Interactions on one element, on one route, make one hot spot.
 * No React or browser dependencies, so the rules can be tested directly.
 */

/** What a hot spot needs of an interaction. */
export interface TimedInteraction {
  readonly id: number;
  readonly target: string;
  readonly anchor: ElementAnchor | null;
  readonly route: string;
  readonly durationMs: number;
  readonly approximate: boolean;
}

export interface HotSpot {
  /** The element and route it's on, which stay the same as interactions are added. */
  readonly key: string;
  /** 1 for the slowest. */
  readonly rank: number;
  /** The element, described for people: `button "Recalculate totals"`. */
  readonly target: string;
  readonly anchor: ElementAnchor | null;
  readonly route: string;
  /** How many slow interactions it had. */
  readonly count: number;
  readonly slowestMs: number;
  /** Whether the slowest was measured without Event Timing. */
  readonly approximate: boolean;
  readonly rating: Exclude<Rating, "good">;
  /** Its interactions, newest first, whose elements the agent kept. */
  readonly interactionIds: readonly number[];
}

const anchorKey = (anchor: ElementAnchor) => `${anchor.path}|${anchor.tag}|${anchor.fingerprint}`;

/** The hot spots among +interactions+, slowest first; ties keep the order their slowest interactions happened. */
export function hotSpots(interactions: readonly TimedInteraction[]): HotSpot[] {
  const groups = new Map<string, TimedInteraction[]>();
  for (const interaction of interactions) {
    if (rate(interaction.durationMs) === "good") continue;
    // An interaction whose element couldn't be described is a hot spot of its own.
    const key = `${interaction.route}#${interaction.anchor ? anchorKey(interaction.anchor) : `interaction-${interaction.id}`}`;
    groups.set(key, [...(groups.get(key) ?? []), interaction]);
  }
  const spots = [...groups].map(([key, group]) => {
    const slowest = group.reduce((worst, interaction) => (interaction.durationMs > worst.durationMs ? interaction : worst));
    return { key, slowest, group };
  });
  spots.sort((left, right) => right.slowest.durationMs - left.slowest.durationMs || left.slowest.id - right.slowest.id);
  return spots.map(({ key, slowest, group }, index) => ({
    key,
    rank: index + 1,
    target: slowest.target,
    anchor: slowest.anchor,
    route: slowest.route,
    count: group.length,
    slowestMs: slowest.durationMs,
    approximate: slowest.approximate,
    rating: rate(slowest.durationMs) as HotSpot["rating"],
    interactionIds: group.map((interaction) => interaction.id).reverse(),
  }));
}

/** A hot spot's time as Timing shows it: `650 ms`, or `≈ 650 ms` when it's approximate. */
export function hotSpotTime(spot: Pick<HotSpot, "slowestMs" | "approximate">): string {
  return `${spot.approximate ? "≈ " : ""}${formatMs(spot.slowestMs)}`;
}

/** A hot spot's outline label: its rank, its slowest time, and its rating in words, `#1 · 650 ms · Poor`. */
export function hotSpotLabel(spot: Pick<HotSpot, "rank" | "slowestMs" | "approximate" | "rating">): string {
  return `#${spot.rank} · ${hotSpotTime(spot)} · ${RATING_LABELS[spot.rating]}`;
}

/** What a hot spot reads of an element: whether it's still in its page. */
interface Connected {
  readonly isConnected: boolean;
}

/**
 * The element of +spot+ on the page now, on +route+: the element one of its
 * interactions was on, while it's still in the page, else the element its
 * anchor finds, or null when it isn't on this page.
 */
export function findHotSpot<E extends AnchorElement & Connected>(spot: Pick<HotSpot, "route" | "anchor" | "interactionIds">, route: string, kept: (id: number) => E | null | undefined, document: { querySelector(selector: string): E | null } | null): E | null {
  if (spot.route !== route) return null;
  for (const id of spot.interactionIds) {
    const element = kept(id);
    if (element?.isConnected) return element;
  }
  return spot.anchor && document ? findAnchored(document, spot.anchor) : null;
}
