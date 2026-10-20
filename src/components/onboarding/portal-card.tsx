import { Status } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import type { PortalListRow } from "@/lib/onboarding/catalog";
import { PORTAL_LIFECYCLE_LABELS, PORTAL_PLATFORM_LABELS } from "@/lib/onboarding/vocabulary";
import styles from "@/components/applications/applications.module.css";

const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;

/**
 * A Portal on the Portals page (runtime-configuration spec, "The Portals page
 * lists every Portal as a card"), built like an Application's card: its
 * initial, name, platform tag, and lifecycle badge, then its owning team and
 * how many Applications and menu items it has. The name submits the card's
 * form, which makes the Portal current and opens its Experience Editor, and
 * it covers the card.
 */
export function PortalCard({ row, action }: { row: PortalListRow; action: (formData: FormData) => Promise<void> }) {
  const { portal } = row;
  return (
    <article className={styles.card} data-portal={portal.publicId}>
      <div className={styles.cardHead}>
        <span className={styles.avatar} aria-hidden="true">
          {portal.label.trim().charAt(0).toUpperCase()}
        </span>
        <div className={styles.cardTitle}>
          <h3 className={styles.name} title={portal.label}>
            <button type="submit" form={`open-${portal.publicId}`} className={`${styles.link} ${styles.linkButton}`} title={`Open ${portal.label}'s Experience Editor`}>
              {portal.label}
            </button>
          </h3>
          <span className={styles.portal}>
            {portal.platform && <Tag sans>{PORTAL_PLATFORM_LABELS[portal.platform]}</Tag>}
            <Status state={portal.lifecycle} label={PORTAL_LIFECYCLE_LABELS[portal.lifecycle]} size="sm" />
          </span>
        </div>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Owning team</dt>
          <dd>{portal.ownerTeam ?? <span className={styles.muted}>None</span>}</dd>
        </div>
        <div>
          <dt>Applications</dt>
          <dd>{count(row.applications, "Application")}</dd>
        </div>
        <div>
          <dt>Menu</dt>
          <dd>{count(row.menuItems, "menu item")}</dd>
        </div>
      </dl>
      {portal.slug && <p className={styles.changed}>{portal.slug}</p>}
      <form id={`open-${portal.publicId}`} action={action} hidden>
        <input type="hidden" name="portal" value={portal.publicId} />
      </form>
    </article>
  );
}
