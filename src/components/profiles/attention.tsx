import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Status, statusLabel } from "@/components/ui/status";
import type { Attention, AttentionItem } from "@/lib/profiles/attention";
import styles from "./profile.module.css";

// The indicator each kind of item shows: its category state, or To review for the input counts, so every item has one.
const ITEM_STATES: Record<AttentionItem["kind"], string> = { conflicting: "conflicting", unknown: "unknown", partial: "partial", not_covered: "not_covered", skipped: "to_review", diagnostics: "to_review" };

/** Everything the Profile couldn't establish, in one checklist, after the counts of categories by state. */
export function NeedsAttention({ attention }: { attention: Attention }) {
  return (
    <Section title="Needs attention" id="attention">
      <Panel>
        <div className={styles.counts} role="group" aria-label="Categories by state">
          {attention.counts.map(({ state, count }) => (
            <Status key={state} state={state} size="sm" label={`${count} ${statusLabel(state).toLowerCase()}`} />
          ))}
        </div>
        {attention.empty ? (
          <p className={styles.nothing}>{attention.empty}</p>
        ) : (
          <ul className={styles.attention} aria-label="Needs attention">
            {attention.items.map((item) => {
              const state = ITEM_STATES[item.kind];
              // One Status holds the state, the link, and the reason: every gap comes from it, and a reason that wraps lines up with the state's label, not under its indicator.
              return (
                <li key={`${item.kind}:${item.href}`}>
                  <Status state={state} size="sm">
                    {item.kind !== "skipped" && item.kind !== "diagnostics" && <span>{statusLabel(state)}</span>}
                    <a href={item.href}>{item.label}</a>
                    <span className={styles.attentionReason}>{item.reason}</span>
                  </Status>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </Section>
  );
}
