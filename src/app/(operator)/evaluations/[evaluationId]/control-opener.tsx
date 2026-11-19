"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import styles from "./evaluation.module.css";

/**
 * What a collapsed Control holds when the Evaluation has too many Findings to
 * carry them all: a link to the address that opens it, with its first page.
 * With JavaScript, opening the Control follows the link, so its Findings
 * arrive as it opens and the address records it.
 */
export function ControlOpener({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const details = link.current?.closest("details");
    if (!details) return;
    const opened = () => {
      if (details.open) router.replace(href, { scroll: false });
    };
    details.addEventListener("toggle", opened);
    // Opened before the page could respond.
    opened();
    return () => details.removeEventListener("toggle", opened);
  }, [href, router]);
  return (
    <p className={styles.opener}>
      <Link ref={link} href={href} scroll={false}>
        {label}
      </Link>
    </p>
  );
}
