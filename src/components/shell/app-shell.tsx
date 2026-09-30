import Link from "next/link";
import type { Theme } from "@/lib/web/theme";
import { NavLink } from "./nav-link";
import { NavigationFeedback } from "./navigation-feedback";
import { ThemeSwitcher } from "./theme-switcher";
import styles from "./app-shell.module.css";

/**
 * The frame around every page: a skip link, the sticky header with the product
 * mark, the primary navigation, and the theme control, and the main region.
 */
export function AppShell({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand} aria-label="Fabricate home">
            <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 2 22 20H2L12 2z" fill="currentColor" />
            </svg>
            <span className={styles.name}>Fabricate</span>
          </Link>
          <nav aria-label="Primary" className={styles.nav}>
            <NavLink href="/" section={["/initiatives", "/assessments", "/evaluations", "/profiles"]}>
              Initiatives
            </NavLink>
            <NavLink href="/sources">Sources</NavLink>
            <NavLink href="/standards">Standards</NavLink>
          </nav>
          <div className={styles.end}>
            <ThemeSwitcher current={theme} />
          </div>
        </div>
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        <NavigationFeedback>{children}</NavigationFeedback>
      </main>
    </>
  );
}
