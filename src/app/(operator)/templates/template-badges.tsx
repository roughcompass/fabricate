import { Icon } from "@/components/ui/icon";
import { Tag } from "@/components/ui/tag";
import { BRANDS, type Template } from "@/lib/demo/catalog";
import styles from "./templates.module.css";

/** A template's brand, and its provider: a DE Web badge, or the community author. */
export function TemplateBadges({ template }: { template: Template }) {
  return (
    <>
      <Tag sans>{BRANDS[template.brand].label}</Tag>
      {template.provider === "de-web" ? (
        <span className={styles.official}>
          <Icon name="checkCircle" size={14} />
          DE Web
        </span>
      ) : (
        <span className={styles.author}>{`By ${template.author}`}</span>
      )}
    </>
  );
}
