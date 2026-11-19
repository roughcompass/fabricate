"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LocationList } from "@/components/results/evidence";
import { buttonProps } from "@/components/ui/button-content";
import { countLabel, formatNumber } from "@/components/ui/count";
import { Disclosure } from "@/components/ui/disclosure";
import { Icon } from "@/components/ui/icon";
import type { HeldSection, RowEvidence } from "@/lib/profiles/evidence";
import { parseReasoning } from "@/lib/profiles/reasoning";
import styles from "./profile.module.css";
import { routes } from "@/lib/web/routes";

type Loading = { state: "idle" | "loading" | "failed" } | { state: "loaded"; evidence: RowEvidence };

/**
 * A row's evidence as a count that opens a panel beside the page, wide enough
 * to read: each fact's locations, key, and raw value, and its rule when the
 * category has several. The page doesn't carry the panel's content: it loads
 * from +url+ when a pointer rests on the count or the panel opens. Without
 * JavaScript, the count is a link to the row's first evidence record instead.
 */
export function EvidencePanel({ url, title, count, first, assessmentId }: { url: string; title: string; count: number; first: string | null; assessmentId: string }) {
  const id = `evidence-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const panel = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<Loading>({ state: "idle" });
  const requested = useRef(false);

  const load = () => {
    if (requested.current) return;
    requested.current = true;
    setLoading({ state: "loading" });
    fetch(url)
      .then((response) => (response.ok ? (response.json() as Promise<RowEvidence>) : Promise.reject(new Error(String(response.status)))))
      .then(
        (evidence) => setLoading({ state: "loaded", evidence }),
        () => {
          requested.current = false;
          setLoading({ state: "failed" });
        },
      );
  };
  // A panel opened before the page could respond loads as soon as it can.
  useEffect(() => {
    if (panel.current?.matches(":popover-open")) load();
  });

  const label = `Show ${countLabel(count, "location")}`;
  return (
    <>
      <button type="button" popoverTarget={id} className={`${styles.evidenceTrigger} ${styles.scripted}`} onPointerEnter={load}>
        {label}
      </button>
      {first ? (
        <Link href={routes.evidence(assessmentId, first)} prefetch={false} className={`${styles.evidenceTrigger} ${styles.unscripted}`}>
          {count === 1 ? "Show location" : `Show first of ${formatNumber(count)} locations`}
        </Link>
      ) : (
        <span className={`${styles.muted} ${styles.unscripted}`}>
          No evidence
        </span>
      )}
      <div ref={panel} id={id} popover="auto" role="dialog" aria-label={`Evidence for ${title}`} aria-busy={loading.state === "loading"} className={styles.sheet} onToggle={(event) => event.newState === "open" && load()}>
        <div className={styles.sheetHeader}>
          <span className={styles.sheetTitle}>{title}</span>
          <button type="button" popoverTarget={id} popoverTargetAction="hide" {...buttonProps("tertiary", "sm", true)} aria-label="Close evidence" title="Close evidence">
            <Icon name="x" size={14} />
          </button>
        </div>
        {loading.state === "loaded" ? (
          loading.evidence.sections.map((section, index) => <HeldView key={index} section={section} assessmentId={loading.evidence.assessmentId} />)
        ) : loading.state === "failed" ? (
          <p className={styles.sheetMessage} role="alert">
            The evidence couldn&apos;t be loaded.{" "}
            <button type="button" className={styles.evidenceTrigger} onClick={load}>
              Try again
            </button>
          </p>
        ) : (
          <p className={styles.sheetMessage}>Loading evidence…</p>
        )}
      </div>
    </>
  );
}

/** Each fact the row holds: its category when there are several, its locations, its key and rule, and its raw value. */
function HeldView({ section, assessmentId }: { section: HeldSection; assessmentId: string }) {
  return (
    <section className={styles.held} aria-label={section.label ?? undefined}>
      {section.label && <h3 className={styles.heldLabel}>{section.label}</h3>}
      <div className={styles.heldPart}>
        <span className={styles.heldPartLabel}>{section.locations.length === 1 ? "Location" : `${formatNumber(section.locations.length)} locations`}</span>
        <LocationList locations={section.locations} assessmentId={assessmentId} />
      </div>
      <dl className={styles.heldFacts}>
        <dt>{section.keys.length + section.moreKeys === 1 ? "Fact" : "Facts"}</dt>
        <dd>
          <span className={styles.mono}>{section.keys.join(", ")}</span>
          {section.moreKeys > 0 && <span className={styles.muted}>{` and ${section.moreKeys} more, each with this value`}</span>}
        </dd>
        {section.rule && (
          <>
            <dt>Rule</dt>
            <dd className={styles.mono}>{section.rule}</dd>
          </>
        )}
        {section.reasoning && (
          <>
            <dt>Why</dt>
            <dd>
              <ReasoningView text={section.reasoning} />
            </dd>
          </>
        )}
      </dl>
      {/* The value as the document stores it, one disclosure away, in a block that scrolls rather than widening the panel. */}
      <div className={styles.quiet}>
        <Disclosure variant="plain" summary="Raw value">
          <pre className={styles.raw} aria-label={`Raw value of ${section.keys[0]}`}>
            {section.raw}
          </pre>
        </Disclosure>
      </div>
    </section>
  );
}

/** A reasoning in full: its statement, then its examples one per line, each with where it was found. */
function ReasoningView({ text }: { text: string }) {
  const parsed = parseReasoning(text);
  if (!parsed) return <>{text}</>;
  return (
    <>
      {parsed.lead}
      <ul className={styles.examples}>
        {parsed.items.map((example, index) => (
          <li key={index}>
            <code className={styles.mono}>{example.text}</code>
            {example.location && <span className={styles.exampleLocation}>{example.location}</span>}
          </li>
        ))}
        {parsed.more > 0 && <li className={styles.muted}>{`and ${parsed.more} more`}</li>}
      </ul>
    </>
  );
}
