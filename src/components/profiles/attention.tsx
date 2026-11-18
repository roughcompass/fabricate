import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Status, statusLabel } from "@/components/ui/status";
import type { Attention, AttentionItem } from "@/lib/profiles/attention";
import styles from "./profile.module.css";

// The indicator each kind of item shows: its category state, or none for the input counts.
const ITEM_STATES: Record<AttentionItem["kind"], string | null> = { conflicting: "conflicting", unknown: "unknown", partial: "partial", not_covered: "not_covered", skipped: null, diagnostics: null };

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
              return (
                <li key={`${item.kind}:${item.href}`}>
                  {state && <Status state={state} size="sm" />}
                  <a href={item.href}>{item.label}</a>
                  <span className={styles.attentionReason}>{item.reason}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </Section>
  );
}
