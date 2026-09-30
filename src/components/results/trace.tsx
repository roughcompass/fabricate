import type { JsonObject } from "@repo-facts/contract";
import { Status } from "@/components/ui/status";
import type { TraceNode } from "@/lib/evaluations/interpreter";
import { COLLECTION_BY_ID, SELECTOR_BY_ID } from "@/lib/standards/registry";
import { EvidenceList } from "./evidence";
import styles from "./results.module.css";
import { formatValue } from "./value";

const RESULTS: Record<TraceNode["result"], string> = { true: "holds", false: "does_not_hold", unknown: "unknown" };

const INCLUDED: Record<TraceNode["result"], string> = { true: "matches the filter", false: "does not match the filter", unknown: "may match the filter" };

function describe(node: TraceNode): React.ReactNode {
  switch (node.op) {
    case "always":
      return "Always";
    case "all":
      return "All of these";
    case "any":
      return "At least one of these";
    case "not":
      return "The opposite of";
    case "every":
    case "some":
    case "count": {
      const collection = COLLECTION_BY_ID.get(node.collection ?? "")?.label ?? node.collection;
      const noun = node.op === "every" ? "Every item in" : node.op === "some" ? "At least one item in" : "The number of items in";
      return (
        <>
          {noun} <strong>{collection}</strong>
        </>
      );
    }
    default: {
      const selector = SELECTOR_BY_ID.get(node.selector ?? "")?.label ?? node.selector;
      return (
        <>
          <strong>{selector}</strong>
          {node.parameter && (
            <>
              {" "}
              of <strong>{node.parameter}</strong>
            </>
          )}
        </>
      );
    }
  }
}

/** How an expression was read against the evidence: each step's result, the value it observed, and why anything is unknown. */
export function TraceView({ trace, records, assessmentId, label }: { trace: TraceNode; records: JsonObject; assessmentId: string; label: string }) {
  return (
    <ul className={styles.trace} aria-label={label}>
      <TraceItem node={trace} records={records} assessmentId={assessmentId} />
    </ul>
  );
}

function TraceItem({ node, records, assessmentId }: { node: TraceNode; records: JsonObject; assessmentId: string }) {
  return (
    <li className={styles.step}>
      <div className={styles.line}>
        <Status state={RESULTS[node.result]} />
        <span>{describe(node)}</span>
      </div>
      {"observed" in node && (
        <div className={styles.detail}>
          {`Observed: ${formatValue(node.observed)}`}
          {node.complete === false && " (the list may be incomplete)"}
        </div>
      )}
      {node.count && <div className={styles.detail}>{node.count.possible === null ? `At least ${node.count.definite}; items that were not seen could add more.` : node.count.possible ? `Between ${node.count.definite} and ${node.count.definite + node.count.possible}.` : `Exactly ${node.count.definite}.`}</div>}
      {node.reason && <div className={styles.muted}>{node.reason}</div>}
      {node.evidence.length > 0 && <EvidenceList ids={node.evidence} records={records} assessmentId={assessmentId} />}
      {node.children && (
        <ul className={styles.trace}>
          {node.children.map((child, index) => (
            <TraceItem key={index} node={child} records={records} assessmentId={assessmentId} />
          ))}
        </ul>
      )}
      {node.items && (
        <ul className={styles.trace}>
          {node.items.length === 0 && <li className={styles.muted}>No items.</li>}
          {node.items.map((item, index) => (
            <li key={index} className={styles.step}>
              <div className={styles.line}>
                <span>
                  <strong>{item.subject}</strong>
                  {item.where && ` ${INCLUDED[item.included]}`}
                </span>
                {item.trace && <Status state={RESULTS[item.result]} />}
              </div>
              {(item.where || item.trace) && (
                <ul className={styles.trace}>
                  {item.where && <TraceItem node={item.where} records={records} assessmentId={assessmentId} />}
                  {item.trace && <TraceItem node={item.trace} records={records} assessmentId={assessmentId} />}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
