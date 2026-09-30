"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./nav-link.module.css";

/**
 * A primary navigation link, marked current on its own page and on every page
 * of its section: `section` lists the other path prefixes that belong to it.
 */
export function NavLink({ href, section = [], children }: { href: string; section?: readonly string[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = href === "/" ? pathname === "/" || section.some((prefix) => pathname.startsWith(prefix)) : pathname.startsWith(href) || section.some((prefix) => pathname.startsWith(prefix));
  return (
    <Link href={href} className={styles.link} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
