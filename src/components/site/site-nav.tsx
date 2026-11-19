"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./site.module.css";

/** The site's sections: the product page and the docs, the current one marked. */
const SECTIONS = [
  { href: "/about", label: "Product", match: /^\/about(\/|$)/ },
  { href: "/docs", label: "Docs", match: /^\/docs(\/|$)/ },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav} aria-label="Site">
      {SECTIONS.map((section) => (
        <Link key={section.href} href={section.href} className={styles.navLink} aria-current={section.match.test(pathname) ? "page" : undefined}>
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
