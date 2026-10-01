"use client";

import { ToolPanel } from "@/components/toolbar/tool-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { memberById } from "@/lib/demo/catalog";
import { useActivity, useCurrentRoute, useRuntime } from "../../runtime/runtime-context";
import { RATING_LABELS, formatMs, hotSpots, rate, slowestInteraction, waterfall } from "./timing";
import { useTiming } from "./timing-state";
import styles from "./timing.module.css";

/**
 * The Timing tool: the order the microfrontends loaded in, how long each
 * interaction took to paint, and the regions that cost the most.
 */
export function TimingPanel() {
  const { app } = useRuntime();
  const { loads } = useActivity();
  const route = useCurrentRoute();
  const timing = useTiming();
  const name = (member: string) => memberById(app, member)?.name ?? member;
  const rows = waterfall(loads);
  const slowest = slowestInteraction(timing.interactions);
  const spots = timing.hotSpots ? hotSpots(route.regions.map((region) => region.member), loads, timing.interactions) : [];

  return (
    <ToolPanel title="Timing" description="Module load order, interaction timing, and performance hot spots for this page." wide>
      <section className={styles.section} aria-labelledby="timing-loads">
        <h3 id="timing-loads" className={styles.sectionTitle}>
          Load order
        </h3>
        <ol className={styles.waterfall} aria-label="Microfrontend loads">
          {rows.map((row, index) => (
            <li key={`${row.member}-${row.kind}-${index}`} className={styles.load} data-load-member={row.member} data-load-kind={row.kind} data-slowest={row.slowest || undefined}>
              <span className={styles.loadName}>
                {name(row.member)} <code>{row.version}</code>
                {row.kind === "swap" && <span className={styles.marker}>{`Version change${row.from ? ` from ${row.from}` : ""}`}</span>}
                {row.slowest && <span className={styles.slowFlag}>Slowest load</span>}
              </span>
              <span className={styles.loadTimes}>{`+${formatMs(row.startMs)} · ${formatMs(row.durationMs)}`}</span>
              <span className={styles.track} aria-hidden="true">
                <span className={styles.bar} data-kind={row.kind} data-slowest={row.slowest || undefined} style={{ left: `${row.offset * 100}%`, width: `${row.width * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section} aria-labelledby="timing-interactions">
        <h3 id="timing-interactions" className={styles.sectionTitle}>
          Interactions
        </h3>
        {!timing.eventTiming && <p className={styles.note}>Approximate: this browser does not support the Event Timing API, so each time is measured to the next frame after the page responds.</p>}
        {slowest ? (
          <p className={styles.summary} data-slowest-interaction="">
            <span className={styles.rating} data-rating={rate(slowest.durationMs)}>
              {RATING_LABELS[rate(slowest.durationMs)]}
            </span>
            {` Slowest so far: ${formatMs(slowest.durationMs)} for ${slowest.kind.toLowerCase()} on ${slowest.target} in ${name(slowest.member)}.`}
          </p>
        ) : (
          <p className={styles.note}>Click, tap, or press keys in the application to time how long it takes to respond.</p>
        )}
        {timing.interactions.length > 0 && (
          <>
            <ol className={styles.interactions} aria-label="Recorded interactions">
              {[...timing.interactions].reverse().map((interaction) => {
                const rating = rate(interaction.durationMs);
                return (
                  <li key={interaction.id} className={styles.interaction} data-interaction-member={interaction.member} data-rating={rating}>
                    <span className={styles.interactionText}>
                      <span>{`${interaction.kind} on ${interaction.target}`}</span>
                      <span className={styles.meta}>{name(interaction.member)}</span>
                    </span>
                    <span className={styles.interactionTime}>
                      {`${interaction.approximate ? "≈ " : ""}${formatMs(interaction.durationMs)}`}
                      <span className={styles.rating} data-rating={rating}>
                        {RATING_LABELS[rating]}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className={styles.actions}>
              <Button size="sm" onClick={timing.clear}>
                Clear interactions
              </Button>
            </div>
          </>
        )}
      </section>

      <section className={styles.section} aria-labelledby="timing-hot-spots">
        <h3 id="timing-hot-spots" className={styles.sectionTitle}>
          Hot spots
        </h3>
        <Checkbox id="timing-hot-spots-toggle" label="Hot spots" description="Tint each region by its cost: its load time plus its slowest interaction." checked={timing.hotSpots} onChange={(event) => timing.setHotSpots(event.currentTarget.checked)} />
        {spots.length > 0 && (
          <ol className={styles.spots} aria-label="Costliest regions">
            {spots.map((spot) => (
              <li key={spot.member} className={styles.spot} data-hot-spot={spot.member} data-level={spot.level}>
                <span>{name(spot.member)}</span>
                <span className={styles.meta}>{`${formatMs(spot.costMs)} (load ${formatMs(spot.loadMs)} + interaction ${formatMs(spot.interactionMs)})`}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </ToolPanel>
  );
}
