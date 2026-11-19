import { NavigationFeedback } from "@/components/shell/navigation-feedback";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import styles from "@/components/site/site.module.css";

/**
 * The product site (product-site spec, "The product site sits beside the
 * operator interface"): the marketing page and the docs, in their own frame,
 * outside the operator shell, with the interface's tokens and the reader's
 * theme, which the root layout applies.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <div className={styles.site} data-site="">
        <SiteHeader />
        <main id="main" className={styles.main} tabIndex={-1}>
          <NavigationFeedback>{children}</NavigationFeedback>
        </main>
        <SiteFooter />
      </div>
    </>
  );
}
