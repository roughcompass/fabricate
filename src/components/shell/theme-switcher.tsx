import { setThemePreference } from "@/app/theme-actions";
import { Icon, type IconName } from "@/components/ui/icon";
import type { Theme } from "@/lib/web/theme";
import styles from "./theme-switcher.module.css";

const OPTIONS: [Theme, IconName, string][] = [
  ["system", "monitor", "System"],
  ["light", "sun", "Light"],
  ["dark", "moon", "Dark"],
];

/**
 * The System/Light/Dark preference, a segmented control in the sidebar's
 * footer. It is a plain form, so it works without JavaScript.
 */
export function ThemeSwitcher({ current }: { current: Theme }) {
  return (
    <form action={setThemePreference} className={styles.switcher} aria-label="Theme">
      {OPTIONS.map(([theme, icon, label]) => (
        <button key={theme} type="submit" name="theme" value={theme} className={styles.option} aria-pressed={theme === current} aria-label={`${label} theme`} title={`${label} theme`}>
          <Icon name={icon} size={14} />
        </button>
      ))}
    </form>
  );
}
