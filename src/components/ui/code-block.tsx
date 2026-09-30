import { CopyButton } from "./copy-button";
import styles from "./code-block.module.css";

/** Source lines with line numbers and a copy control. Long lines wrap; the numbers mark where each line starts. */
export function CodeBlock({ code, firstLine, label }: { code: string; firstLine?: number | null; label: string }) {
  const lines = code.split("\n");
  return (
    <figure className={styles.block} aria-label={label} data-panel="">
      <figcaption className={styles.caption}>
        <span className={styles.label}>{label}</span>
        <CopyButton value={code} label="Copy lines" />
      </figcaption>
      <pre className={styles.code}>
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
