import Link from "next/link";
import { ProductMark } from "@/components/shell/product-mark";
import { ButtonLink } from "@/components/ui/button";
import { PRODUCT } from "@/lib/product";
import { SiteNav } from "./site-nav";
import styles from "./site.module.css";

/**
 * The product site's header (product-site spec, "The product site sits
 * beside the operator interface"): the site's banner landmark, with the
 * product mark and name, which open the product page, the site's sections,
 * Product and Docs, and Open the Frontend Registry, which opens Home.
 */
export function SiteHeader() {
  return (
    <header className={styles.header} data-site-header="">
      <Link href="/about" className={styles.brand} aria-label={`${PRODUCT.name} product page`}>
        <ProductMark className={styles.mark} />
        <span className={styles.name}>{PRODUCT.name}</span>
      </Link>
      <SiteNav />
      <span className={styles.open}>
        <ButtonLink href="/" variant="secondary">{`Open the ${PRODUCT.name}`}</ButtonLink>
      </span>
    </header>
  );
}
