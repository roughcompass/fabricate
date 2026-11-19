import type { JsonValue } from "@repo-facts/contract";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Severity } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import { COLLECTION_BY_ID, SELECTOR_BY_ID } from "@/lib/standards/registry";
import styles from "./control-view.module.css";
import { asObject } from "@/lib/json";

/**
 * A complete, read-only rendering of Controls: every field, and every
 * expression node with its registry identifier. Render it inside a flush Panel;
 * the Controls are divided, not boxed.
 */

const COMPARATOR_WORDS: Record<string, string> = { eq: "equals", lt: "is less than", lte: "is at most", gt: "is more than", gte: "is at least" };

export function ControlList({ controls }: { controls: JsonValue }) {
  const list = Array.isArray(controls) ? controls : [];
  if (!list.length) return <EmptyState title="No Controls">A Standard needs at least one Control before it can be published.</EmptyState>;
  return (
    <ol className={styles.list}>
      {list.map((control, index) => (
        <li key={index} className={styles.item}>
          <ControlDefinition control={control} />
        </li>
      ))}
    </ol>
  );
}

function ControlDefinition({ control }: { control: JsonValue }) {
  const value = asObject(control);
  const key = String(value.key ?? "");
  return (
    <article aria-label={`Control ${key}`} className={styles.control}>
      <header className={styles.header}>
        <h3 className={styles.title}>{String(value.title ?? "Untitled Control")}</h3>
        <Severity value={typeof value.severity === "string" ? value.severity : "unknown"} />
      </header>
      <DescriptionList
        items={[
          ["Key", <Tag key="key">{key}</Tag>],
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

/**
 * An expression in words. With `paths={false}`, as a Finding leads with it,
 * fields and collections read by their names alone, and their paths wait in
 * a disclosure (content standard, "Two layers").
 */
export function ExpressionView({ expression, paths = true }: { expression: JsonValue; paths?: boolean }) {
  return <div className={styles.expression}>{describe(expression, paths)}</div>;
}

function describe(expression: JsonValue, paths = true): React.ReactNode {
  const node = asObject(expression);
  const identifier = (id: JsonValue | undefined) => (paths ? <code className={styles.id}>{String(id ?? "")}</code> : null);
  const field = () => {
    const selector = typeof node.selector === "string" ? SELECTOR_BY_ID.get(node.selector) : undefined;
    return (
      <>
        <strong>{selector?.label ?? "Unknown field"}</strong>
        {typeof node.parameter === "string" && (
          <>
            {" "}
            of <strong>{node.parameter}</strong>
          </>
        )}{" "}
        {identifier(node.selector)}
      </>
    );
  };
  const values = (items: JsonValue | undefined) => (Array.isArray(items) ? items.map((item) => String(item)).join(", ") : "");
  const children = (label: string, items: JsonValue[]) => (
    <>
      {label}
      <ul className={styles.tree}>
        {items.map((item, index) => (
          <li key={index}>{describe(item, paths)}</li>
        ))}
      </ul>
    </>
  );
  const collection = () => {
    const definition = typeof node.collection === "string" ? COLLECTION_BY_ID.get(node.collection) : undefined;
    return (
      <>
        <strong>{definition?.label ?? "Unknown collection"}</strong> {identifier(node.collection)}
      </>
    );
  };
  const where = () =>
    node.where ? (
      <ul className={styles.tree}>
        <li>Only those where: {describe(node.where, paths)}</li>
      </ul>
    ) : null;

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
      return (
        <>
          {field()} is <strong>{String(node.value)}</strong>
        </>
      );
    case "in":
      return (
        <>
          {field()} is one of <strong>{values(node.values)}</strong>
        </>
      );
    case "compare":
      return (
        <>
          {field()} {COMPARATOR_WORDS[String(node.comparator)] ?? String(node.comparator)} <strong>{String(node.value)}</strong>
        </>
      );
    case "contains":
      return (
        <>
          {field()} contains {node.mode === "all" ? "all of" : "any of"} <strong>{values(node.values)}</strong>
        </>
      );
    case "semver_satisfies":
      return (
        <>
          {field()} satisfies <strong>{String(node.range)}</strong>
        </>
      );
    case "every":
    case "some":
      return (
        <>
          {node.op === "every" ? "Every item in" : "At least one item in"} {collection()} satisfies:
          {where()}
          <ul className={styles.tree}>
            <li>{describe(node.condition ?? null, paths)}</li>
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

