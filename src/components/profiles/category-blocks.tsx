import type { JsonObject } from "@repo-facts/contract";
import { useId } from "react";
import { EvidenceList } from "@/components/results/evidence";
import { NoValuePlaceholder } from "@/components/results/no-value";
import { buttonProps } from "@/components/ui/button-content";
import { countLabel } from "@/components/ui/count";
import { Disclosure } from "@/components/ui/disclosure";
import { Icon } from "@/components/ui/icon";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import type { Cell } from "@/lib/profiles/layouts";
import type { CategoryBlock, CompactBlock, Heading, HeldFact, Row, SharedBlock, SharedCell, SharedRow } from "@/lib/profiles/view";
import styles from "./profile.module.css";

/** What a cell needs to link evidence: the records, and the Run they belong to. */
export interface EvidenceContext {
  records: JsonObject;
  assessmentId: string;
  /** Category labels by id, to name each fact a row holds. */
  labels: ReadonlyMap<string, string>;
}

/** A category with facts: its heading, its search and rule, and its facts in its own columns. */
export function CategoryTable({ block, context }: { block: CategoryBlock; context: EvidenceContext }) {
  const { definition } = block.heading;
  const span = block.columns.length + (block.stepsColumn ? 1 : 0);
  return (
    <Section id={definition.id} level={3} title={definition.label} description={definition.description} actions={<Status state={block.heading.state} />}>
      <SearchLine heading={block.heading} />
      <Panel flush>
        <Table
          label={definition.label}
          head={
            <>
              {block.columns.map((column) => (
                <Th key={column}>{column}</Th>
              ))}
              {block.stepsColumn && <Th>{block.stepsColumn}</Th>}
              <Th>Evidence</Th>
            </>
          }
        >
          {block.rows.map((row) => (
            <tr key={row.id}>
              <RowCellsView row={row} columns={block.columns} span={span} context={context} />
              {block.stepsColumn && row.cells.kind === "cells" && (
                <Td label={block.stepsColumn}>
                  {row.steps.length ? (
                    <ul className={styles.steps}>
                      {row.steps.map((step, index) => (
                        <li key={index}>
                          <CellView cell={step} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className={styles.muted}>None</span>
                  )}
                </Td>
              )}
              <Td label="Evidence">
                <RowDetails title={row.cells.kind === "cells" ? (row.cells.cells[0]?.text ?? row.id) : row.id} held={row.held} evidence={row.evidence} context={context} reasoning={false} />
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </Section>
  );
}

function RowCellsView({ row, columns, span, context }: { row: Row; columns: readonly string[]; span: number; context: EvidenceContext }) {
  const state = row.state && <Status state={row.state} size="sm" />;
  const reasoning = row.reasoning && <Secondary>{row.reasoning}</Secondary>;
  if (row.cells.kind === "whole") {
    return (
      <Td label="Value" span={span}>
        {row.cells.text} {state}
        {reasoning}
      </Td>
    );
  }
  if (row.cells.kind === "candidates") {
    return (
      <Td label="Value" span={span}>
        <Status state="conflicting" size="sm" />
        <ul className={styles.candidates} aria-label="Candidates">
          {row.cells.candidates.map((candidate, index) => (
            <li key={index}>
              {candidate.text} <EvidenceList ids={candidate.evidence} records={context.records} assessmentId={context.assessmentId} source={false} />
            </li>
          ))}
        </ul>
      </Td>
    );
  }
  return (
    <>
      {row.cells.cells.map((cell, index) => (
        <Td key={columns[index]} label={columns[index]}>
          {cell ? <CellView cell={cell} /> : null}
          {index === 0 && state}
          {index === 0 && reasoning}
        </Td>
      ))}
    </>
  );
}

export function CellView({ cell }: { cell: Cell }) {
  return (
    <>
      <span className={[cell.mono && styles.mono, cell.muted && styles.muted].filter(Boolean).join(" ") || undefined}>{cell.text}</span>
      {cell.secondary && <Secondary>{cell.secondary}</Secondary>}
    </>
  );
}

/**
 * A row's evidence as a count that opens a panel beside the page, wide enough
 * to read: each fact's locations, key, and raw value, and its rule when the
 * category has several. It's a native popover, so it opens and closes without
 * JavaScript, and Escape or a click outside closes it. A category row shows
 * its reasoning beside its value, so only a shared row's panel repeats it.
 */
function RowDetails({ title, held, evidence, context, reasoning = true }: { title: string; held: readonly HeldFact[]; evidence: readonly string[]; context: EvidenceContext; reasoning?: boolean }) {
  const id = `evidence-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <>
      <button type="button" popoverTarget={id} className={styles.evidenceTrigger}>
        {`Show ${countLabel(evidence.length, "location")}`}
      </button>
      <div id={id} popover="auto" role="dialog" aria-label={`Evidence for ${title}`} className={styles.sheet}>
        <div className={styles.sheetHeader}>
          <span className={styles.sheetTitle}>{title}</span>
          <button type="button" popoverTarget={id} popoverTargetAction="hide" {...buttonProps("tertiary", "sm", true)} aria-label="Close evidence" title="Close evidence">
            <Icon name="x" size={14} />
          </button>
        </div>
        {held.map((entry) => (
          <div key={`${entry.category}:${entry.fact.key}`} className={styles.held}>
            {held.length > 1 && <span className={styles.heldLabel}>{context.labels.get(entry.category) ?? entry.category}</span>}
            <EvidenceList ids={entry.fact.evidence} records={context.records} assessmentId={context.assessmentId} source={false} />
            <span className={styles.secondary}>
              Fact <span className={styles.mono}>{entry.fact.key}</span>
              {entry.rule && (
                <>
                  {" · rule "}
                  <span className={styles.mono}>{entry.rule}</span>
                </>
              )}
            </span>
            {reasoning && entry.fact.reasoning && <span className={styles.secondary}>{entry.fact.reasoning}</span>}
            <pre className={styles.raw} aria-label={`Raw value of ${entry.fact.key}`}>
              {JSON.stringify(entry.fact.value, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </>
  );
}

/** How far a category's search went and which rule its facts came from. */
export function SearchLine({ heading }: { heading: Heading }) {
  const { search, rules } = heading;
  if (!search) return null;
  const outcome = search.skipped.length ? `${countLabel(search.skipped.length, "input")} skipped` : search.complete ? "complete" : "incomplete";
  const parts = search.surface.length ? [`Searched ${countLabel(search.surface.length, "input")}`, outcome] : [`Search ${outcome}`];
  return (
    <div className={styles.search}>
      <span>{parts.join(" · ")}</span>
      {rules.length === 1 && (
        <span>
          Rule <code>{rules[0]}</code>
        </span>
      )}
      {rules.length > 1 && (
        <Disclosure variant="plain" summary={countLabel(rules.length, "rule")}>
          <ul className={`${styles.inputs} ${styles.mono}`}>
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </Disclosure>
      )}
      {search.surface.length > 0 && (
        <Disclosure variant="plain" summary="Inputs searched">
          <ul className={`${styles.inputs} ${styles.mono}`}>
            {search.surface.map((path) => (
              <li key={path}>{path || "(repository)"}</li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

const SHARED_TITLES: Record<SharedBlock["kind"], { title: string; description: string }> = {
  dependencies: { title: "Dependencies", description: "Direct dependencies by manifest, with their declared ranges, the versions lockfiles resolve, and whether they're internal" },
  scripts: { title: "Package scripts", description: "Scripts declared in package manifests, with what each one checks (never run)" },
};

/** A table that several categories share, with one heading line per source category, each with its own anchor, state, search, and rule. */
export function SharedTable({ block, context, filters }: { block: SharedBlock; context: EvidenceContext; filters?: React.ReactNode }) {
  const [first, ...others] = block.sources;
  const { title, description } = SHARED_TITLES[block.kind];
  const rows = block.groups.reduce((sum, group) => sum + group.rows.length, 0);
  return (
    <Section id={first!.definition.id} level={3} title={title} description={description}>
      <ul className={styles.sources} aria-label={`Categories in ${title}`}>
        {[first!, ...others].map((source, index) => (
          <li key={source.definition.id} id={index === 0 ? undefined : source.definition.id}>
            <span className={styles.sourceLabel}>{source.definition.label}</span>
            <Status state={source.state} size="sm" />
            <SearchLine heading={source} />
          </li>
        ))}
      </ul>
      {filters}
      <Panel flush>
        <Table
          label={title}
          head={
            <>
              {block.columns.map((column) => (
                <Th key={column.label}>
                  <span className={styles.header}>
                    {column.label}
                    {column.category && <Status state={block.sources.find((source) => source.definition.id === column.category)!.state} size="sm" />}
                  </span>
                </Th>
              ))}
              <Th>Evidence</Th>
            </>
          }
        >
          {block.groups.map((group) => (
            <SharedGroup key={group.manifest ?? ""} kind={block.kind} manifest={group.manifest} rows={group.rows} columns={block.columns.map((column) => column.label)} context={context} />
          ))}
          {rows === 0 && (
            <tr>
              <Td span={block.columns.length + 1}>
                <span className={styles.muted}>No row matches the filters.</span>
              </Td>
            </tr>
          )}
        </Table>
      </Panel>
    </Section>
  );
}

function SharedGroup({ kind, manifest, rows, columns, context }: { kind: SharedBlock["kind"]; manifest: string | null; rows: readonly SharedRow[]; columns: readonly string[]; context: EvidenceContext }) {
  if (!rows.length) return null;
  const label = manifest ?? (kind === "dependencies" ? "Other packages consumed" : "Other declared commands");
  return (
    <>
      <tr className={styles.groupRow}>
        <Td span={columns.length + 1}>
          <span className={manifest ? styles.mono : undefined}>{label}</span> <span className={styles.count}>{`(${rows.length})`}</span>
        </Td>
      </tr>
      {rows.map((row) => (
        <tr key={row.id}>
          {row.cells.map((cell, index) => (
            <Td key={columns[index]} label={columns[index]}>
              <SharedCellView cell={cell} />
            </Td>
          ))}
          <Td label="Evidence">
            <RowDetails title={row.manifest ? `${row.name} · ${row.manifest}` : row.name} held={row.held} evidence={row.evidence} context={context} />
          </Td>
        </tr>
      ))}
    </>
  );
}

function SharedCellView({ cell }: { cell: SharedCell }) {
  if (cell.kind === "none") return <NoValuePlaceholder value={cell.value} />;
  if (cell.kind === "whole") return <span>{cell.text}</span>;
  return (
    <>
      <CellView cell={cell.cell} />
      {cell.state && <Status state={cell.state} size="sm" />}
    </>
  );
}

/** The categories of a group that have no facts: one compact row each, with its state and reason. */
export function CompactList({ block }: { block: CompactBlock }) {
  return (
    <Panel flush>
      <ul className={styles.compact} aria-label={`${block.group} categories without facts`}>
        {block.items.map(({ definition, value }) => (
          <li key={definition.id} id={definition.id} className={styles.compactRow}>
            <div className={styles.compactName}>
              <Primary>{definition.label}</Primary>
              <Secondary>{value.reason}</Secondary>
            </div>
            <Status state={value.state} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
