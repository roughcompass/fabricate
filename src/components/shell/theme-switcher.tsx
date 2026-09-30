import { setThemePreference } from "@/app/theme-actions";
import { Icon, type IconName } from "@/components/ui/icon";
import { Menu, MenuAction } from "@/components/ui/menu";
import type { Theme } from "@/lib/web/theme";
import styles from "./theme-switcher.module.css";

const OPTIONS: [Theme, IconName, string][] = [
  ["system", "monitor", "System"],
  ["light", "sun", "Light"],
  ["dark", "moon", "Dark"],
];

/**
 * The System/Light/Dark preference: a segmented control on wide screens and a
 * menu on narrow ones. Both are plain forms, so they work without JavaScript.
 */
export function ThemeSwitcher({ current }: { current: Theme }) {
  const [, currentIcon] = OPTIONS.find(([theme]) => theme === current)!;
  return (
    <>
      <form action={setThemePreference} className={styles.switcher} aria-label="Theme">
        {OPTIONS.map(([theme, icon, label]) => (
          <button key={theme} type="submit" name="theme" value={theme} className={styles.option} aria-pressed={theme === current} aria-label={`${label} theme`} title={`${label} theme`}>
            <Icon name={icon} size={14} />
          </button>
        ))}
      </form>
      <span className={styles.compact}>
        <Menu label="Theme" icon={currentIcon}>
          {OPTIONS.map(([theme, icon, label]) => (
            <MenuAction key={theme} action={setThemePreference} fields={{ theme }} icon={icon}>
              {label}
              {theme === current && <span className={styles.current}>Current</span>}
            </MenuAction>
          ))}
        </Menu>
      </span>
    </>
  );
}
