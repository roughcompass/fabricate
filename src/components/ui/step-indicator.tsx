import { Icon } from "./icon";
import styles from "./step-indicator.module.css";

/**
 * A flow's steps and where the reader is: "Step 2 of 3", then each step's
 * title, done steps checked and the current one marked. Steps are labels,
 * not links; a flow's review step links back to each step instead.
 */
export function StepIndicator({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <nav className={styles.indicator} aria-label="Steps">
      <p className={styles.position}>{`Step ${current} of ${steps.length}`}</p>
      <ol className={styles.steps}>
        {steps.map((step, index) => {
          const number = index + 1;
          const state = number < current ? "done" : number === current ? "current" : "upcoming";
          return (
            <li key={step} className={styles.step} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className={styles.marker} aria-hidden="true">
                {state === "done" ? <Icon name="check" size={14} /> : number}
              </span>
              <span className={styles.label}>
                {step}
                {state === "done" && <span className="visually-hidden"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
