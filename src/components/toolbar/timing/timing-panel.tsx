"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { countLabel } from "@/components/ui/count";
import { Tooltip } from "@/components/ui/tooltip";
import { RATING_LABELS, VITALS, formatMs, formatVital, rate, rateVital, slowestInteraction, waterfall } from "@/components/toolbar/timing/timing";
import styles from "@/components/toolbar/timing/timing.module.css";
import { useTargetDocument } from "../target-document";
import { ToolPanel } from "../tool-panel";
import { hotSpotTime } from "./hot-spots";
import { hotSpotElement, useHotSpotRects } from "./hot-spots-overlay";
import { useTiming } from "./timing-state";

/**
 * The Timing tool over a running application: the page load's Web Vitals,
 * the scripts, stylesheets, and remote entries it loaded in the order they
 * started, how long each interaction took to paint, with its route, and the
 * hot spots behind the slow ones.
 */
export function TimingPanel() {
  const timing = useTiming();
  const rows = waterfall(timing.loads);
  const slowest = slowestInteraction(timing.interactions);

  const vitalRows = VITALS.map((vital) => {
    const value = vital.name === "INP" ? timing.inpMs : (timing.vitals[vital.name]?.value ?? null);
    return { ...vital, value, rating: value === null ? null : rateVital(vital.name, value) };
  });

  return (
    <ToolPanel title="Timing" description="Web Vitals, load order, interaction timing, and hot spots for this page." wide>
      <section className={styles.section} aria-labelledby="timing-vitals">
        <h3 id="timing-vitals" className={styles.sectionTitle}>
          Web Vitals
        </h3>
        <ul className={styles.vitals} aria-label="Web Vitals">
          {vitalRows.map((vital, index) => (
            <li key={vital.name} className={styles.vital} data-vital={vital.name} data-rating={vital.rating ?? undefined}>
              <Tooltip
                focusable
                className={styles.vitalBody}
                placement="below"
                align={index < 2 ? "start" : index > 2 ? "end" : "center"}
                content={`${vital.title}. ${vital.description} Good at ${formatVital(vital.name, vital.good)} or less; poor above ${formatVital(vital.name, vital.poor)}. ${vital.name === "INP" ? "Measured since the page loaded." : "Measured for this page load."}`}
              >
                <span className={styles.vitalName}>{vital.name}</span>
                <span className={styles.vitalValue}>{vital.value === null ? "–" : formatVital(vital.name, vital.value)}</span>
                <span className={styles.vitalRating}>{vital.rating ? RATING_LABELS[vital.rating] : vital.name === "INP" ? "No interactions" : "Measuring"}</span>
              </Tooltip>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="timing-loads">
        <h3 id="timing-loads" className={styles.sectionTitle}>
          Load order
        </h3>
        <p className={styles.note}>The scripts, stylesheets, and remote entries the page loaded, in the order they started, from the start of its navigation. The browser measured each one.</p>
        {rows.length === 0 ? (
          <p className={styles.note}>{timing.inspecting ? "The page hasn't loaded any scripts or stylesheets." : "Measuring…"}</p>
        ) : (
          <ol className={styles.waterfall} aria-label="Loaded files">
            {rows.map((row) => (
              <li key={`${row.url}@${row.startMs}`} className={styles.load} data-load-file={row.file} data-load-kind={row.kind} data-slowest={row.slowest || undefined}>
                <span className={styles.loadName}>
                  <code>{row.file}</code>
                  <span>{row.kind}</span>
                  {row.slowest && <span className={styles.slowFlag}>Slowest load</span>}
                </span>
                <span className={styles.loadTimes}>{`+${formatMs(row.startMs)} · ${formatMs(row.durationMs)}`}</span>
                <span className={styles.track} aria-hidden="true">
                  <span className={styles.bar} data-slowest={row.slowest || undefined} style={{ left: `${row.offset * 100}%`, width: `${row.width * 100}%` }} />
                </span>
              </li>
            ))}
          </ol>
        )}
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
            {` Slowest so far: ${formatMs(slowest.durationMs)} for ${slowest.kind.toLowerCase()} on ${slowest.target} at ${slowest.route}.`}
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
                  <li key={interaction.id} className={styles.interaction} data-interaction-route={interaction.route} data-rating={rating}>
                    <span className={styles.interactionText}>
                      <span>{`${interaction.kind} on ${interaction.target}`}</span>
                      <span className={styles.meta}>{interaction.route}</span>
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

      <HotSpots />
    </ToolPanel>
  );
}

/**
 * The hot spots section: Show hot spots, which outlines them on the page,
 * and the ranked list, where selecting one scrolls its element into view and
 * highlights it. One that isn't on this page is listed with its route.
 */
function HotSpots() {
  const timing = useTiming();
  const target = useTargetDocument();
  const onRoute = timing.hotSpots.filter((spot) => spot.route === target.route);
  // Measured while listed, so one removed from the page reads as not on it.
  const rects = useHotSpotRects(onRoute, onRoute.length > 0);
  const locate = (key: string) => {
    const spot = timing.hotSpots.find((candidate) => candidate.key === key);
    const element = spot ? hotSpotElement(spot, target) : null;
    timing.setShowHotSpots(true);
    timing.selectHotSpot(key);
    element?.scrollIntoView({ block: "center", inline: "nearest" });
  };
  return (
    <section className={styles.section} aria-labelledby="timing-hot-spots">
      <h3 id="timing-hot-spots" className={styles.sectionTitle}>
        Hot spots
      </h3>
      <Checkbox
        id="timing-hot-spots-toggle"
        label="Show hot spots"
        description="Outline the elements behind interactions that needed improvement or were poor, ranked by their slowest."
        checked={timing.showHotSpots}
        onChange={(event) => timing.setShowHotSpots(event.currentTarget.checked)}
      />
      <p className={styles.note}>Based on the interactions measured in this page since it loaded, never the toolbar&apos;s own. Interactions of 200 ms or less aren&apos;t hot spots.</p>
      {onRoute.length === 0 && <p className={styles.note} data-no-hot-spots="">No interaction on this route needed improvement.</p>}
      {timing.hotSpots.length > 0 && (
        <ol className={styles.spots} aria-label="Hot spots">
          {timing.hotSpots.map((spot) => {
            const here = rects.has(spot.key);
            return (
              <li key={spot.key} data-hot-spot={spot.rank} data-rating={spot.rating}>
                <button type="button" className={styles.spotButton} aria-pressed={timing.selectedHotSpot === spot.key} onClick={() => locate(spot.key)}>
                  <span className={styles.spotText}>
                    <span>
                      <span className={styles.spotRank}>{`#${spot.rank}`}</span>
                      {` ${spot.target}`}
                    </span>
                    <span className={styles.meta}>{here ? `${countLabel(spot.count, "slow interaction")} on ${spot.route}` : `Not on this page · ${spot.route}`}</span>
                  </span>
                  <span className={styles.interactionTime}>
                    {hotSpotTime(spot)}
                    <span className={styles.rating} data-rating={spot.rating}>
                      {RATING_LABELS[spot.rating]}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
