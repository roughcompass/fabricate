import { CopyButton } from "./copy-button";
import styles from "./code-block.module.css";

/**
 * Source lines with line numbers and a copy control. Long lines wrap; the
 * numbers mark where each line starts. With +scroll+, the lines scroll inside
 * a bounded height, as a build log's do, and the scrolling area takes focus
 * so it scrolls from the keyboard.
 */
export function CodeBlock({ code, firstLine, label, scroll = false }: { code: string; firstLine?: number | null; label: string; scroll?: boolean }) {
  const lines = code.split("\n");
  return (
    <figure className={styles.block} aria-label={label} data-panel="">
      <figcaption className={styles.caption}>
        <span className={styles.label}>{label}</span>
        <CopyButton value={code} label="Copy lines" />
      </figcaption>
      <pre className={scroll ? `${styles.code} ${styles.scroll}` : styles.code} tabIndex={scroll ? 0 : undefined} aria-label={scroll ? label : undefined} data-code-scroll={scroll ? "" : undefined}>
        <code>
          {lines.map((line, index) => (
            <span key={index} className={styles.line}>
              {firstLine != null && (
                <span className={styles.number} aria-hidden="true">
                  {firstLine + index}
                </span>
              )}
              <span className={styles.text}>{line}</span>
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
