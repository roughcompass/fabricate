import Link from "next/link";
import { DescriptionList } from "@/components/ui/description-list";
import { RelativeTime } from "@/components/ui/relative-time";
import type { Attempt, Provenance } from "@/lib/prototypes/types";
import styles from "./prototype.module.css";

/**
 * How a version was made (generation spec, "Every version records its
 * provenance"): the model, its personas as they were, the intent or message,
 * the scope and direction, the lessons it applied and the Salt guidance it
 * consulted, the Salt release and registry, its check attempts, its parent,
 * and when it was created.
 */
export function ProvenanceView({ provenance, attempts, parentHref, parentNumber }: { provenance: Provenance; attempts: readonly Attempt[]; parentHref: string | null; parentNumber: number | null }) {
  const lookups = provenance.saltGuidance;
  const entries = [...new Set(lookups.flatMap((lookup) => lookup.entries))];
  return (
    <div className={styles.provenance} data-provenance="">
      <DescriptionList
        items={[
          ["Model", provenance.model],
          ["Personas", provenance.personas.length ? provenance.personas.map((persona) => `${persona.name}, ${persona.role}`).join("; ") : "None"],
          ["Intent", provenance.intent],
          ...(provenance.message ? ([["Message", provenance.message]] as const) : []),
          ["Scope", provenance.scope === "page" ? "Page" : "Component"],
          ["Direction", provenance.direction ? `${provenance.direction.title}: ${provenance.direction.sentence}` : "None"],
          ["Lessons applied", provenance.lessons.length ? <ol className={styles.plainList}>{provenance.lessons.map((lesson) => <li key={lesson.id}>{lesson.text}</li>)}</ol> : "None"],
          ["Salt guidance consulted", entries.length ? entries.join(", ") : "None"],
          ["Salt release", `Rendered and checked with Salt ${provenance.saltRelease}; guidance from the Salt ${provenance.registryRelease} registry`],
          ["Salt kit", provenance.kitVersion],
          ["Check attempts", `${attempts.length} (${attempts.map((attempt) => (attempt.passed ? "passed" : "failed")).join(", ")})`],
          ["Parent version", parentHref && parentNumber ? <Link href={parentHref}>{`v${parentNumber}`}</Link> : provenance.forkedFrom ? <Link href={`/prototypes/${provenance.forkedFrom.prototypeId}?v=${provenance.forkedFrom.number}`}>{`Forked from ${provenance.forkedFrom.prototypeName} v${provenance.forkedFrom.number}`}</Link> : provenance.startedFromTemplate ? `Started from the template ${provenance.startedFromTemplate.title} v${provenance.startedFromTemplate.templateVersion}` : "None"],
          ["Created", <RelativeTime key="created" value={new Date(provenance.createdAt)} />],
        ]}
      />
      {lookups.length > 0 && (
        <details className={styles.lookups}>
          <summary>{`Salt lookups (${lookups.length})`}</summary>
          <ul className={styles.plainList}>
            {lookups.map((lookup, index) => (
              <li key={index}>
                <code>{lookup.tool}</code> {lookup.query}
                {lookup.entries.length > 0 && <span className={styles.muted}>{` → ${lookup.entries.join(", ")}`}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
