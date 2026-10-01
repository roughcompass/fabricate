"use client";

import { useTrackedRects } from "../geometry";
import { Placed } from "../placed";
import { useAudit } from "./audit-state";
import styles from "./accessibility.module.css";

/**
 * The audit drawn on the page: every affected element outlined in its
 * impact's color and labeled with its result number, placed clear of the
 * toolbar. The selected result's elements are highlighted.
 */
export function AuditOverlay() {
  const audit = useAudit();
  const { report } = audit;
  const active = Boolean(report && report.results.length && audit.showOutlines);
  const keys = report?.results.flatMap((result) => result.nodes.map((node, index) => `${result.number}:${index}`)).join(",") ?? "";
  const rects = useTrackedRects(
    () => {
      const elements = new Map<string, Element>();
      for (const result of report?.results ?? []) {
        result.nodes.forEach((node, index) => {
          const element = node.selector ? document.querySelector(node.selector) : null;
          if (element) elements.set(`${result.number}:${index}`, element);
        });
      }
      return elements;
    },
    active,
    keys,
  );
  if (!active || !report) return null;

  return (
    <div className={styles.layer} data-overlay="" aria-hidden="true">
      {report.results.flatMap((result) =>
        result.nodes.map((node, index) => {
          const rect = rects.get(`${result.number}:${index}`);
          if (!rect) return null;
          const highlighted = audit.selected === result.number;
          return (
            <div
              key={`${result.number}:${index}`}
              className={styles.outline}
              style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
              data-impact={result.impact}
              data-highlighted={highlighted || undefined}
              data-audit-outline={result.number}
            >
              <Placed follow preferred={(size) => ({ top: rect.top + 2 - size.height, left: rect.left })} className={styles.outlineLabel}>
                {result.number}
              </Placed>
            </div>
          );
        }),
      )}
    </div>
  );
}
