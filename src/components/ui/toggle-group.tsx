"use client";

import { useRouter } from "next/navigation";
import { Icon, type IconName } from "./icon";
import styles from "./toggle-group.module.css";

interface ToggleGroupProps {
  /** The page the choice applies to; the chosen value becomes `name` in its query. */
  action: string;
  label: string;
  name: string;
  options: readonly { value: string; label: string; icon?: IconName }[];
  selected: string;
  /** Query values to keep, such as other choices on the page. */
  keep?: Record<string, string>;
}

/**
 * Mutually exclusive choices as a row of buttons, the chosen one pressed. The
 * choice lives in the URL: each button submits a GET form, so it works without
 * JavaScript, and with JavaScript it navigates in place.
 */
export function ToggleGroup({ action, label, name, options, selected, keep = {} }: ToggleGroupProps) {
  const router = useRouter();
  return (
    <form
      action={action}
      method="get"
      className={styles.form}
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (!(submitter instanceof HTMLButtonElement)) return;
        event.preventDefault();
        const params = new URLSearchParams(keep);
        params.set(name, submitter.value);
        router.push(`${action}?${params}`, { scroll: false });
      }}
    >
      {Object.entries(keep).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <div role="group" aria-label={label} className={styles.group}>
        {options.map((option) => (
          <button key={option.value} type="submit" name={name} value={option.value} className={styles.option} aria-pressed={option.value === selected}>
            {option.icon && <Icon name={option.icon} size={14} />}
            {option.label}
          </button>
        ))}
      </div>
    </form>
  );
}
