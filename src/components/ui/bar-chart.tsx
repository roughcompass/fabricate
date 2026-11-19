import styles from "./bar-chart.module.css";

type BarTone = "error" | "warning" | "success" | "neutral";
type BarPattern = "solid" | "stripes" | "dots" | "lines";

export interface BarSeries {
  readonly id: string;
  readonly label: string;
  readonly tone: BarTone;
  /** Sets the series apart without color: solid, diagonal stripes, dots, or horizontal lines. */
  readonly pattern: BarPattern;
}

export interface BarGroup {
  readonly label: string;
  /** Each series' value in this bar, by series id. */
  readonly values: Readonly<Record<string, number>>;
}

const WIDTH = 640;
const HEIGHT = 180;
const LABELS = 24;
const TOTALS = 16;
const GAP = 0.35;

/** The fill of a series' segments: its pattern, or its tone for a solid one. */
const fillOf = (id: string, series: BarSeries) => (series.pattern === "solid" ? undefined : `url(#${id}-${series.id})`);

/** A solid series takes its tone's fill from the stylesheet, which would hide a pattern's, so only it gets the class. */
const toneOf = (series: BarSeries) => (series.pattern === "solid" ? styles[`tone-${series.tone}`] : "");

function Pattern({ id, series }: { id: string; series: BarSeries }) {
  if (series.pattern === "solid") return null;
  return (
    <pattern id={`${id}-${series.id}`} width="6" height="6" patternUnits="userSpaceOnUse" className={styles[`tone-${series.tone}`]}>
      <rect width="6" height="6" fill="currentColor" />
      {series.pattern === "stripes" && <path d="M-1 1 1-1M0 6 6 0M5 7 7 5" className={styles.patternInk} />}
      {series.pattern === "lines" && <path d="M0 3H6" className={styles.patternInk} />}
      {series.pattern === "dots" && <circle cx="3" cy="3" r="1.2" className={styles.patternDot} />}
    </pattern>
  );
}

/**
 * A stacked bar chart (design-system.md, "BarChart"), drawn as SVG on the
 * server, so it needs no client JavaScript. Each bar is a group, such as a
 * week, stacked by series in order and labeled with its total and its group
 * label. Every series has a pattern as well as a tone, and a legend names
 * them. The same figures are a visually hidden table, the chart's text
 * alternative. +id+ keeps the patterns of two charts on one page apart.
 */
export function BarChart({ id, label, series, groups, groupLabel = "Group", empty }: { id: string; label: string; series: readonly BarSeries[]; groups: readonly BarGroup[]; groupLabel?: string; empty?: string }) {
  const totals = groups.map((group) => series.reduce((sum, entry) => sum + (group.values[entry.id] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const slot = WIDTH / Math.max(groups.length, 1);
  const barWidth = slot * (1 - GAP);
  const plot = HEIGHT - LABELS - TOTALS;
  const blank = totals.every((total) => total === 0) && Boolean(empty);
  return (
    <figure className={styles.chart} data-bar-chart={id}>
      {blank ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <svg className={styles.svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false">
          <defs>
            {series.map((entry) => (
              <Pattern key={entry.id} id={id} series={entry} />
            ))}
          </defs>
          <line x1="0" x2={WIDTH} y1={TOTALS + plot} y2={TOTALS + plot} className={styles.axis} />
          {groups.map((group, index) => {
            const x = index * slot + (slot - barWidth) / 2;
            let y = TOTALS + plot;
            return (
              <g key={group.label}>
                {series.map((entry) => {
                  const value = group.values[entry.id] ?? 0;
                  if (value === 0) return null;
                  const height = (value / max) * plot;
                  y -= height;
                  return (
                    <rect key={entry.id} x={x} y={y} width={barWidth} height={height} rx="2" className={`${styles.segment} ${toneOf(entry)}`} fill={fillOf(id, entry)}>
                      <title>{`${group.label}: ${value} ${entry.label}`}</title>
                    </rect>
                  );
                })}
                {totals[index]! > 0 && (
                  <text x={x + barWidth / 2} y={y - 4} textAnchor="middle" className={styles.value}>
                    {totals[index]}
                  </text>
                )}
                <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle" className={styles.label}>
                  {group.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {/* With nothing drawn there's nothing to key, and the swatches' patterns live in the drawing. */}
      {!blank && <ul className={styles.legend} aria-hidden="true">
        {series.map((entry) => (
          <li key={entry.id}>
            <svg className={styles.swatch} viewBox="0 0 12 12" focusable="false">
              <rect width="12" height="12" className={toneOf(entry)} fill={fillOf(id, entry)} />
            </svg>
            {entry.label}
          </li>
        ))}
      </ul>}
      {/* Inside a hidden box: a table sizes to its content, so the box clips it. */}
      <div className="visually-hidden">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">{groupLabel}</th>
              {series.map((entry) => (
                <th key={entry.id} scope="col">
                  {entry.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.label}>
                <th scope="row">{group.label}</th>
                {series.map((entry) => (
                  <td key={entry.id}>{group.values[entry.id] ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
