import Link from "next/link";
import { PRODUCT } from "@/lib/product";
import styles from "./site.module.css";

/** The product site's footer: what the product is, and where to go next, for people and for their agents. */
export function SiteFooter() {
  return (
    <footer className={styles.footer} data-site-footer="">
      <p className={styles.footerText}>{`The ${PRODUCT.name} is the Digital Enablement team's registry of CIB frontend applications.`}</p>
      <nav className={styles.footerLinks} aria-label="Footer">
        <Link href="/about">Product</Link>
        <Link href="/docs">Docs</Link>
        <a href="/llms.txt">Docs for agents (llms.txt)</a>
        <Link href="/">{`Open the ${PRODUCT.name}`}</Link>
      </nav>
    </footer>
  );
}
