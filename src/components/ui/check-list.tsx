import { Icon } from "./icon";
import { Tag } from "./tag";
import styles from "./check-list.module.css";

export interface CheckListItem {
  title: string;
  description: string;
  /** Marks the item "New". */
  badge?: "new";
}

/**
 * What something includes, as items with a check mark, a title, a one-line
 * description, and an optional "New" tag. A link may end the list, opening in
 * a new tab.
 */
export function CheckList({ label, items, link }: { label: string; items: readonly CheckListItem[]; link?: { label: string; href: string } }) {
  return (
    <div className={styles.wrap}>
      <ul className={styles.list} aria-label={label}>
        {items.map((item) => (
          <li key={item.title} className={styles.item}>
            <Icon name="check" className={styles.check} />
            <span className={styles.text}>
              <span className={styles.title}>
                {item.title}
                {item.badge === "new" && <Tag sans>New</Tag>}
              </span>
              <span className={styles.description}>{item.description}</span>
            </span>
          </li>
        ))}
      </ul>
      {link && (
        <a className={styles.link} href={link.href} target="_blank" rel="noreferrer">
          <Icon name="external" />
          {link.label}
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      )}
    </div>
  );
}
