import type { JsonObject, JsonValue } from "@repo-facts/contract";
import { Badge } from "@/components/ui/badge";
import { DetailsList } from "@/components/ui/layout";
import { COLLECTION_BY_ID, SELECTOR_BY_ID } from "@/lib/standards/registry";
import styles from "./standards.module.css";

/** A complete, read-only rendering of Controls: every field, and every expression node with its registry identifier. */

const COMPARATOR_WORDS: Record<string, string> = { eq: "equals", lt: "is less than", lte: "is at most", gt: "is more than", gte: "is at least" };
const SEVERITY_TONES: Record<string, "error" | "warning" | "info" | "neutral"> = { critical: "error", high: "error", medium: "warning", low: "info", info: "neutral" };

export function ControlList({ controls }: { controls: JsonValue }) {
  const list = Array.isArray(controls) ? controls : [];
  if (!list.length) return <p className={styles.muted}>No Controls.</p>;
  return (
    <ol className={styles.controls}>
      {list.map((control, index) => (
        <li key={index} className={styles.control}>
          <ControlDefinition control={control} />
        </li>
      ))}
    </ol>
  );
}

function ControlDefinition({ control }: { control: JsonValue }) {
  const value = record(control);
  const severity = typeof value.severity === "string" ? value.severity : "unknown";
  return (
    <article aria-label={`Control ${String(value.key ?? "")}`}>
      <header className={styles.controlHeader}>
        <h3 className={styles.controlTitle}>{String(value.title ?? "Untitled Control")}</h3>
        <Badge tone={SEVERITY_TONES[severity] ?? "neutral"}>{severity}</Badge>
      </header>
      <DetailsList
        items={[
          ["Key", <code key="key">{String(value.key ?? "")}</code>],
          ["Subject", value.subject === "relationship_map" ? "The Relationship Map, once per Evaluation" : "Each assessed repository"],
          ["Rationale", String(value.rationale ?? "")],
          ["Applies when", <ExpressionView key="applicability" expression={value.applicability ?? null} />],
          ["Expected", <ExpressionView key="condition" expression={value.condition ?? null} />],
          ["Guidance", typeof value.guidance === "string" && value.guidance ? value.guidance : <span className={styles.muted}>None</span>],
        ]}
      />
    </article>
  );
}

export function ExpressionView({ expression }: { expression: JsonValue }) {
  return <div className={styles.expression}>{describe(expression)}</div>;
}

function describe(expression: JsonValue): React.ReactNode {
  const node = record(expression);
  const field = () => {
    const selector = typeof node.selector === "string" ? SELECTOR_BY_ID.get(node.selector) : undefined;
    return (
      <>
        <strong>{selector?.label ?? "Unknown field"}</strong>
        {typeof node.parameter === "string" && <> of <strong>{node.parameter}</strong></>} <code className={styles.id}>{String(node.selector ?? "")}</code>
      </>
    );
  };
  const values = (items: JsonValue | undefined) => (Array.isArray(items) ? items.map((item) => String(item)).join(", ") : "");
  const children = (label: string, items: JsonValue[]) => (
    <>
      {label}
      <ul className={styles.tree}>
        {items.map((item, index) => (
          <li key={index}>{describe(item)}</li>
        ))}
      </ul>
    </>
  );
  const collection = () => {
    const definition = typeof node.collection === "string" ? COLLECTION_BY_ID.get(node.collection) : undefined;
    return (
      <>
        <strong>{definition?.label ?? "Unknown collection"}</strong> <code className={styles.id}>{String(node.collection ?? "")}</code>
      </>
    );
  };
  const where = () => (node.where ? <ul className={styles.tree}><li>Only those where: {describe(node.where)}</li></ul> : null);

  switch (node.op) {
    case "always":
      return "Always";
    case "all":
      return children("All of:", Array.isArray(node.items) ? node.items : []);
    case "any":
      return children("Any of:", Array.isArray(node.items) ? node.items : []);
    case "not":
      return children("Not:", [node.item ?? null]);
    case "exists":
      return <>{field()} is known and present</>;
    case "equals":
      return <>{field()} is <strong>{String(node.value)}</strong></>;
    case "in":
      return <>{field()} is one of <strong>{values(node.values)}</strong></>;
    case "compare":
      return <>{field()} {COMPARATOR_WORDS[String(node.comparator)] ?? String(node.comparator)} <strong>{String(node.value)}</strong></>;
    case "contains":
      return <>{field()} contains {node.mode === "all" ? "all of" : "any of"} <strong>{values(node.values)}</strong></>;
    case "semver_satisfies":
      return <>{field()} satisfies <strong>{String(node.range)}</strong></>;
    case "every":
    case "some":
      return (
        <>
          {node.op === "every" ? "Every item in" : "At least one item in"} {collection()} satisfies:
          {where()}
          <ul className={styles.tree}>
            <li>{describe(node.condition ?? null)}</li>
          </ul>
        </>
      );
    case "count":
      return (
        <>
          The number of items in {collection()} {COMPARATOR_WORDS[String(node.comparator)] ?? String(node.comparator)} <strong>{String(node.value)}</strong>
          {where()}
        </>
      );
    default:
      return <span className={styles.muted}>Unsupported expression</span>;
  }
}

function record(value: JsonValue | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
