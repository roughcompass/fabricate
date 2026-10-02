import Link from "next/link";
import { countLabel } from "@/components/ui/count";
import { Disclosure } from "@/components/ui/disclosure";
import type { Signal } from "@/lib/relationships/diagram";
import { BOX, MAX_BOXES, layoutDiagram } from "@/lib/relationships/layout";
import type { DiagramBox, DiagramData } from "@/lib/relationships/levels";
import styles from "./diagram.module.css";

/*
 * A Relationship Map diagram (design decision 6): server-rendered SVG whose
 * boxes link to their focus, with a text equivalent. The drawing describes
 * itself through aria-describedby; below 768px of content width, and for a
 * diagram too large to draw, the text equivalent replaces it.
 */

const TYPE_LABELS: Record<string, string> = {
  package_dependency: "package dependency",
  package_production: "package production",
  composition: "composition",
  iframe: "iframe",
  runtime_contract: "runtime contract",
  service_call: "service call",
};

// What fits a box at each text size: the label in secondary type, the second line in caption type.
const LABEL_LENGTH = 24;
const DETAIL_LENGTH = 30;
const truncate = (text: string, length = LABEL_LENGTH) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

export function signalSummary(signals: readonly Signal[]): string {
  const types = [...new Set(signals.map((signal) => TYPE_LABELS[signal.type] ?? signal.type))].join(", ");
  return signals.length > 1 ? `${types}, ${countLabel(signals.length, "signal")}` : types;
}

export function Diagram({ id, label, data }: { id: string; label: string; data: DiagramData }) {
  const boxes = data.rows.flat();
  const byNode = new Map(boxes.map((box) => [box.nodeId, box]));
  const layout = layoutDiagram(
    data.rows.map((row) => row.map((box) => ({ key: box.nodeId, label: box.label }))),
    data.model.arrows.map((arrow) => ({ from: arrow.from, to: arrow.to })),
  );
  const badges = new Map(data.model.badges.map((badge) => [badge.box, badge]));
  const stubs = new Map<string, number>();
  for (const stub of data.model.stubs) stubs.set(stub.box, (stubs.get(stub.box) ?? 0) + 1);
  const descriptionId = `${id}-description`;

  return (
    <figure className={styles.figure} aria-label={label}>
      {layout.tooLarge ? (
        <p className={styles.note}>{`This diagram has ${countLabel(layout.boxes, "box", "boxes")}, more than ${MAX_BOXES}, so it's shown as a list.`}</p>
      ) : boxes.length === 0 ? (
        <p className={styles.note}>Nothing to draw at this level.</p>
      ) : (
        <svg className={styles.drawing} role="img" aria-label={label} aria-describedby={descriptionId} viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ maxWidth: layout.width }} data-diagram={id}>
          <defs>
            <marker id={`${id}-head`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className={styles.head} />
            </marker>
          </defs>
          {layout.arrows.map((arrow) => {
            const signals = data.model.arrows.find((item) => item.from === arrow.from && item.to === arrow.to)!.signals;
            return (
              <path key={`${arrow.from}-${arrow.to}`} d={arrow.path} className={styles.arrow} markerEnd={`url(#${id}-head)`} data-arrow={`${byNode.get(arrow.from)?.label}→${byNode.get(arrow.to)?.label}`}>
                <title>{`${byNode.get(arrow.from)?.label} → ${byNode.get(arrow.to)?.label}: ${signalSummary(signals)}`}</title>
              </path>
            );
          })}
          {layout.boxes.map((positioned) => {
            const box = byNode.get(positioned.key)!;
            const badge = badges.get(box.nodeId);
            const stub = stubs.get(box.nodeId);
            const second = [box.detail, ...box.marks].filter(Boolean).join(" · ");
            return (
              <a key={box.nodeId} href={box.href} className={styles.boxLink} data-box={box.label}>
                <title>{[box.label, second].filter(Boolean).join(" · ")}</title>
                <rect x={positioned.x} y={positioned.y} width={positioned.width} height={positioned.height} rx={6} className={box.marks.includes("Host") ? styles.host : styles.box} />
                <text x={positioned.x + 12} y={positioned.y + 23} className={styles.label}>
                  {truncate(box.label)}
                </text>
                {second && (
                  <text x={positioned.x + 12} y={positioned.y + 42} className={styles.detail}>
                    {truncate(second, DETAIL_LENGTH)}
                  </text>
                )}
                {badge && (
                  <text x={positioned.x + positioned.width - 10} y={positioned.y + 18} textAnchor="end" className={styles.badge}>
                    Self
                  </text>
                )}
                {stub !== undefined && (
                  <>
                    <path d={`M ${positioned.x + positioned.width} ${positioned.y + BOX.height / 2} h ${BOX.gapX / 2 + 4}`} className={styles.stub} strokeDasharray="3 3" />
                    <circle cx={positioned.x + positioned.width + BOX.gapX / 2 + 6} cy={positioned.y + BOX.height / 2} r={3} className={styles.stubEnd} />
                  </>
                )}
              </a>
            );
          })}
        </svg>
      )}

      <p id={descriptionId} className={styles.description}>
        {describe(data, byNode)}
      </p>

      <div className={layout.tooLarge || boxes.length === 0 ? styles.listAlways : styles.list}>
        <TextEquivalent data={data} byNode={byNode} />
      </div>

      {data.thirdParty.length > 0 && (
        <Disclosure variant="plain" summary={`Leaves out ${countLabel(data.thirdParty.length, "third-party package")}`}>
          <ul className={styles.packages} aria-label="Third-party packages left out">
            {data.thirdParty.map((item) => (
              <li key={item.name}>
                <Link href={item.href}>{item.name}</Link>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </figure>
  );
}

/** One paragraph a screen reader reads as the drawing's description. */
function describe(data: DiagramData, byNode: Map<string, DiagramBox>): string {
  const name = (id: string) => byNode.get(id)?.label ?? id;
  const arrows = data.model.arrows.map((arrow) => `${name(arrow.from)} to ${name(arrow.to)}, ${signalSummary(arrow.signals)}`);
  const parts = [`${countLabel(byNode.size, "repository", "repositories")} in ${countLabel(data.rows.filter((row) => row.length > 0).length, "row")}.`];
  if (arrows.length > 0) parts.push(`Arrows: ${arrows.join("; ")}.`);
  if (data.model.stubs.length > 0) parts.push(`${countLabel(data.model.stubs.length, "unmatched reference")}.`);
  if (data.thirdParty.length > 0) parts.push(`${countLabel(data.thirdParty.length, "third-party package")} left out.`);
  return parts.join(" ");
}

/** The diagram as a list: each box in row order with its outgoing arrows, badges, and stubs. */
function TextEquivalent({ data, byNode }: { data: DiagramData; byNode: Map<string, DiagramBox> }) {
  const outgoing = (id: string) => data.model.arrows.filter((arrow) => arrow.from === id);
  return (
    <ol className={styles.equivalent} aria-label="Diagram as a list">
      {data.rows.flat().map((box) => {
        const badge = data.model.badges.find((item) => item.box === box.nodeId);
        const stubs = data.model.stubs.filter((stub) => stub.box === box.nodeId);
        const arrows = outgoing(box.nodeId);
        return (
          <li key={box.nodeId}>
            <Link href={box.href}>{box.label}</Link>
            {[box.detail, ...box.marks].filter(Boolean).length > 0 && <span className={styles.secondary}>{` · ${[box.detail, ...box.marks].filter(Boolean).join(" · ")}`}</span>}
            {(arrows.length > 0 || badge || stubs.length > 0) && (
              <ul>
                {arrows.map((arrow) => (
                  <li key={arrow.to}>{`→ ${byNode.get(arrow.to)?.label ?? arrow.to}, ${signalSummary(arrow.signals)}`}</li>
                ))}
                {badge && <li>{`Relates to itself: ${signalSummary(badge.signals)}`}</li>}
                {stubs.map((stub) => (
                  <li key={stub.edgeId}>{`Unmatched ${TYPE_LABELS[stub.type] ?? stub.type}: ${stub.label}`}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
