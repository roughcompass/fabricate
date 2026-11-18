import styles from "./indicator.module.css";

/** Progress is work under way, and pulses; info shares its color for a settled state that is neither good nor bad, and holds still. */
export type Tone = "neutral" | "success" | "warning" | "error" | "progress" | "info";

/** The indicator's shape. The states that carry no value each have their own, so they differ without their labels; blank keeps a place. */
export type IndicatorShape = "dot" | "ring" | "dash" | "blank";

/** The class that maps a data-tone to var(--_tone), for anything that paints in a tone. */
export const toneClass = styles.tone;

/**
 * A state's indicator, the only one there is: Status, the section menu, and
 * every legend draw it, so a dot, a ring, or a dash looks the same, at the
 * same size and in the same color, wherever it appears. Hidden from
 * assistive technology; its label says the state.
 */
export function Indicator({ tone = "neutral", shape = "dot" }: { tone?: Tone; shape?: IndicatorShape }) {
  return <span className={`${styles.tone} ${styles.indicator}`} data-tone={tone} data-shape={shape} aria-hidden="true" />;
}
