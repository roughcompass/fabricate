import type { Attribution } from "@/lib/db/schema";
import { attributionLabel } from "@/lib/onboarding/attribution";
import styles from "./onboarding.module.css";

/**
 * Who did something, as they stated it, labeled Unverified; or DE FabLab
 * itself, labeled Automatic. No onboarding record claims more than that.
 */
export function Attributed({ name, attribution }: { name: string; attribution: Attribution }) {
  return (
    <span className={styles.attribution}>
      <span>{name}</span>
      <span className={styles.label}>{attributionLabel(attribution)}</span>
    </span>
  );
}
