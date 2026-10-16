import { Icon } from "@/components/ui/icon";
import { Status, statusLabel } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import { BRANDS } from "@/lib/demo/catalog";
import type { GalleryTemplate } from "@/lib/demo/gallery";
import { attribution } from "@/lib/prototypes/templates";
import styles from "./templates.module.css";

/**
 * A template's brand, and its provider: a DE Web badge or the community
 * author. A template accepted from a prototype is a community template with a
 * From Prototypes badge, who accepted it (unverified), its template version,
 * whether it meets the Standards it was accepted against, and its re-check
 * status when that isn't Unchanged.
 */
export function TemplateBadges({ template }: { template: GalleryTemplate }) {
  return (
    <>
      <Tag sans>{BRANDS[template.brand].label}</Tag>
      {/* A built-in template other than a hero isn't real Salt (template-gallery spec, "Illustrative templates"). */}
      {template.origin !== "prototypes" && !template.hero && (
        <span className={styles.author} data-illustrative="">
          Illustrative
        </span>
      )}
      {template.provider === "de-web" ? (
        <span className={styles.official}>
          <Icon name="checkCircle" size={14} />
          DE Web
        </span>
      ) : template.origin === "prototypes" ? (
        <>
          <span className={styles.official} data-from-prototypes="">
            <Icon name="flask" size={14} />
            From Prototypes
          </span>
          <span className={styles.author}>{`Accepted by ${attribution(template.acceptedBy ?? "")}`}</span>
          {template.templateVersion && <span className={styles.author}>{`v${template.templateVersion}`}</span>}
          {template.recheck && <Status size="sm" state={`recheck_${template.recheck.status}`} label={`${statusLabel(`recheck_${template.recheck.status}`)} on Salt ${template.recheck.saltRelease}`} />}
        </>
      ) : (
        <span className={styles.author}>{`By ${template.author}`}</span>
      )}
      {template.standards && <Status size="sm" state={template.standards} label={template.standards === "meets" ? "Meets selected Standards" : undefined} />}
    </>
  );
}
