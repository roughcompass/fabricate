"use client";

import styles from "@/components/toolbar/accessibility/accessibility.module.css";
import { Placed } from "@/components/toolbar/placed";
import { useTargetDocument, useTargetRects } from "../target-document";
import { useAudit } from "./audit-state";

/**
 * The audit drawn over the running application: every affected element
 * outlined in its impact's color and labeled with its result number, placed
 * clear of the toolbar. The selected result's elements are highlighted. Only
 * results for the route the frame shows are drawn, since another route's
 * selectors could match the wrong elements.
 */
export function AuditOverlay() {
  const audit = useAudit();
  const target = useTargetDocument();
  const { report } = audit;
  const results = (report?.results ?? []).map((result) => ({ ...result, nodes: result.nodes.filter((node) => node.route === target.route) }));
  const active = Boolean(results.some((result) => result.nodes.length) && audit.showOutlines);
  const keys = results.flatMap((result) => result.nodes.map((node, index) => `${result.number}:${index}`)).join(",");
  const rects = useTargetRects(
    (document) => {
      const elements = new Map<string, Element>();
      for (const result of results) {
        result.nodes.forEach((node, index) => {
          const element = node.selector ? document.querySelector(node.selector) : null;
          if (element) elements.set(`${result.number}:${index}`, element);
        });
      }
      return elements;
    },
    active,
    `${keys}|${target.changes}`,
  );
  if (!active) return null;

  return (
    <div className={styles.layer} data-overlay="" aria-hidden="true">
      {results.flatMap((result) =>
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
