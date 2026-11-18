import { Icon } from "@/components/ui/icon";
import { Tag } from "@/components/ui/tag";
import { BRANDS } from "@/lib/demo/catalog";
import type { GalleryTemplate } from "@/lib/demo/gallery";
import styles from "./templates.module.css";

/** A template's brand, and its provider: a DE Web badge or the community author. */
export function TemplateBadges({ template }: { template: GalleryTemplate }) {
  return (
    <>
      <Tag sans>{BRANDS[template.brand].label}</Tag>
      {/* A built-in template other than a hero isn't real Salt (template-gallery spec, "Illustrative templates"). */}
      {!template.hero && (
        <span className={styles.author} data-illustrative="">
          Illustrative
        </span>
      )}
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
