import { CopyButton } from "./copy-button";
import styles from "./tag.module.css";

interface TagProps {
  children: React.ReactNode;
  /** The full value to copy, when the tag shows a shortened one. Defaults to the text itself when `copy` is set. */
  value?: string;
  copy?: boolean;
  /** A description of the value for the copy control, such as "digest". */
  label?: string;
  /** Plain text instead of an identifier. */
  sans?: boolean;
}

/** An identifier, digest, commit, path, or URL in the monospace face, optionally copyable. */
export function Tag({ children, value, copy = false, label = "value", sans = false }: TagProps) {
  const copyValue = value ?? (typeof children === "string" ? children : undefined);
  return (
    <span className={styles.wrap}>
      <span className={sans ? styles.sans : styles.tag} title={value}>
        {children}
      </span>
      {copy && copyValue && <CopyButton value={copyValue} label={`Copy ${label}`} />}
    </span>
  );
}

/** A value shown shortened, with the whole value on hover and in the copy control. */
export function ShortValue({ value, length = 12, label = "value" }: { value: string; length?: number; label?: string }) {
  return (
    <Tag value={value} copy label={label}>
      {value.slice(0, length)}
    </Tag>
  );
}

/** A group of tags that wraps. */
export function TagList({ values, empty = "None" }: { values: readonly string[]; empty?: string }) {
  if (!values.length) return <span className={styles.empty}>{empty}</span>;
  return (
    <span className={styles.list}>
      {values.map((value) => (
        <Tag key={value} sans>
          {value}
        </Tag>
      ))}
    </span>
  );
}
