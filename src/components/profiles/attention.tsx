import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Status, statusLabel } from "@/components/ui/status";
import type { Attention, AttentionItem } from "@/lib/profiles/attention";
import { profileSectionHref } from "@/lib/profiles/tabs";
import styles from "./profile.module.css";

// The indicator each kind of item shows: its category state, or To review for the input counts, so every item has one.
const ITEM_STATES: Record<AttentionItem["kind"], string> = { conflicting: "conflicting", unknown: "unknown", partial: "partial", not_covered: "not_covered", skipped: "to_review", diagnostics: "to_review" };

/**
 * Everything the Profile couldn't establish, in one checklist, after the
 * counts of categories by state. The Overview shows the first +limit+ items
 * and leads to the rest in Diagnostics, which shows them all.
 */
export function NeedsAttention({ attention, base, limit }: { attention: Attention; base: string; limit?: number }) {
  const items = limit === undefined ? attention.items : attention.items.slice(0, limit);
  const rest = attention.items.length - items.length;
  const content = (
    <>
      <div className={styles.counts} role="group" aria-label="Categories by state">
        {attention.counts.map(({ state, count }) => (
          <Status key={state} state={state} size="sm" label={`${count} ${statusLabel(state).toLowerCase()}`} />
        ))}
      </div>
      {attention.empty ? (
        <p className={styles.nothing}>{attention.empty}</p>
      ) : (
        <ul className={styles.attention} aria-label="Needs attention">
          {items.map((item) => {
            const state = ITEM_STATES[item.kind];
            // One Status holds the state, the link, and the reason: every gap comes from it, and a reason that wraps lines up with the state's label, not under its indicator.
            return (
              <li key={`${item.kind}:${item.section}`}>
                <Status state={state} size="sm">
                  {item.kind !== "skipped" && item.kind !== "diagnostics" && <span>{statusLabel(state)}</span>}
                  <a href={profileSectionHref(base, item.section)}>{item.label}</a>
                  <span className={styles.attentionReason}>{item.reason}</span>
                </Status>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
  if (limit !== undefined) {
    return (
      <Panel title="Needs attention" footer={rest > 0 ? <Link href={profileSectionHref(base, "needs-attention")} className={styles.panelLink}>{`All ${attention.items.length} in Diagnostics`}</Link> : undefined}>
        {content}
      </Panel>
    );
  }
  return (
    <Section title="Needs attention" id="needs-attention">
      <Panel>{content}</Panel>
    </Section>
  );
}
