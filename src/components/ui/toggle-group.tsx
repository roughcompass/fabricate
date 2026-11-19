"use client";

import { useRouter } from "next/navigation";
import { Icon, type IconName } from "./icon";
import { Tooltip } from "./tooltip";
import styles from "./toggle-group.module.css";
import { HiddenFields } from "./form";

interface ToggleGroupProps {
  /** The page the choice applies to; the chosen value becomes `name` in its query. */
  action: string;
  label: string;
  name: string;
  options: readonly { value: string; label: string; icon?: IconName }[];
  selected: string;
  /** Query values to keep, such as other choices on the page. */
  keep?: Record<string, string>;
  /** Shows each option as its icon alone, named by its label and with the label as a tooltip. Every option needs an icon. */
  iconOnly?: boolean;
}

/**
 * Mutually exclusive choices as a row of buttons, the chosen one pressed. The
 * choice lives in the URL: each button submits a GET form, so it works without
 * JavaScript, and with JavaScript it navigates in place. `iconOnly` shows the
 * options as icons, each named by its label and with it as a tooltip.
 */
export function ToggleGroup({ action, label, name, options, selected, keep = {}, iconOnly = false }: ToggleGroupProps) {
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
      <HiddenFields values={keep} />
      <div role="group" aria-label={label} className={styles.group}>
        {options.map((option) =>
          iconOnly ? (
            <Tooltip key={option.value} content={option.label}>
              <button type="submit" name={name} value={option.value} className={[styles.option, styles.iconOnly].join(" ")} aria-pressed={option.value === selected} aria-label={option.label}>
                {option.icon && <Icon name={option.icon} size={16} />}
              </button>
            </Tooltip>
          ) : (
            <button key={option.value} type="submit" name={name} value={option.value} className={styles.option} aria-pressed={option.value === selected}>
              {option.icon && <Icon name={option.icon} size={14} />}
              {option.label}
            </button>
          ),
        )}
      </div>
    </form>
  );
}
