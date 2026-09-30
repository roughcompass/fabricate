"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./nav-link.module.css";

/** A primary navigation link marked as current for its whole section. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = href === "/" ? pathname === "/" || pathname.startsWith("/initiatives") || pathname.startsWith("/assessments") || pathname.startsWith("/profiles") || pathname.startsWith("/evaluations") : pathname.startsWith(href);
  return (
    <Link href={href} className={styles.link} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
