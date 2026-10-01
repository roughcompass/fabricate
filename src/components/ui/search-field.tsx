import Link from "next/link";
import { Field } from "./form";
import { Icon } from "./icon";
import styles from "./search-field.module.css";

type Size = "sm" | "md" | "lg";
const ICON_SIZES: Record<Size, number> = { sm: 14, md: 16, lg: 16 };

interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "size" | "type"> {
  id: string;
  label: string;
  description?: React.ReactNode;
  /** Keeps the label for assistive technology only, as in a filter bar. */
  hideLabel?: boolean;
  size?: Size;
  /**
   * Where Clear search goes: the same page without the search. Shown while the
   * field has a value; it is a link, so it works without JavaScript.
   */
  clearHref?: string;
}

/**
 * A search input with a leading search icon and a clear control. It submits
 * with its form, so searching works without client-side JavaScript.
 */
export function SearchField({ id, label, description, hideLabel = false, size = "md", clearHref, defaultValue, ...input }: SearchFieldProps) {
  const hasValue = typeof defaultValue === "string" ? defaultValue !== "" : defaultValue !== undefined;
  return (
    <Field id={id} label={label} description={description} hideLabel={hideLabel}>
      <div className={[styles.field, styles[size]].join(" ")}>
        <Icon name="search" size={ICON_SIZES[size]} className={styles.icon} />
        <input
          id={id}
          type="search"
          className={styles.input}
          defaultValue={defaultValue}
          autoComplete="off"
          aria-describedby={description ? `${id}-description` : undefined}
          {...input}
        />
        {clearHref && hasValue && (
          <Link href={clearHref} className={styles.clear} scroll={false} aria-label="Clear search">
            <Icon name="x" size={ICON_SIZES[size]} />
          </Link>
        )}
      </div>
    </Field>
  );
}
