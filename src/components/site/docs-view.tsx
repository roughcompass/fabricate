import Link from "next/link";
import { ContentTemplate } from "@/components/templates/content-template";
import { buttonProps } from "@/components/ui/button-content";
import { Icon } from "@/components/ui/icon";
import type { DocPage, DocsSite } from "@/lib/docs/site";
import { CopyPage } from "./copy-page";
import { DocsArticle } from "./docs-article";
import styles from "./docs.module.css";

/**
 * A docs page (product-site spec, "Every docs page has the same frame") on
 * the Content template's docs variant: the docs navigation, the page's title
 * and summary, Copy page and View as Markdown, the release it describes, the
 * article, a list of its headings, and the pages before and after it.
 */
export function DocsView({ site, doc }: { site: DocsSite; doc: DocPage }) {
  const { page, release, article } = doc;
  const contents = article.headings.filter((heading) => heading.depth <= 3);
  return (
    <ContentTemplate
      header={{
        title: page.title,
        description: page.summary,
        extraActions: (
          <>
            <CopyPage markdown={doc.markdown} />
            {/* A document, not a page of the app: the browser loads it as the Markdown it is. */}
            <a href={page.markdownHref} {...buttonProps("secondary")}>
              <Icon name="code" size={16} />
              View as Markdown
            </a>
          </>
        ),
      }}
      navLabel="Docs pages"
      nav={
        <nav className={styles.nav} aria-label="Docs">
          {site.sections.map((section) => (
            <div key={section.id} className={styles.navSection}>
              <p className={styles.navHeading}>{section.title}</p>
              <ul className={styles.navList}>
                {section.pages.map((item) => (
                  <li key={item.path}>
                    <Link href={item.href} className={styles.navLink} aria-current={item.path === page.path ? "page" : undefined}>
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      }
      toc={
        contents.length > 0 && (
          <nav className={styles.toc} aria-label="On this page">
            <p className={styles.navHeading}>On this page</p>
            <ul className={styles.navList}>
              {contents.map((heading) => (
                <li key={heading.id} data-depth={heading.depth}>
                  <a href={`#${heading.id}`} className={styles.tocLink}>
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )
      }
      pager={
        (doc.previous || doc.next) && (
          <nav className={styles.pager} aria-label="Previous and next pages">
            {doc.previous ? (
              <Link href={doc.previous.href} className={styles.pagerLink} rel="prev">
                <span className={styles.pagerLabel}>Previous</span>
                <span className={styles.pagerTitle}>{doc.previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {doc.next && (
              <Link href={doc.next.href} className={`${styles.pagerLink} ${styles.pagerNext}`} rel="next">
                <span className={styles.pagerLabel}>Next</span>
                <span className={styles.pagerTitle}>{doc.next.title}</span>
              </Link>
            )}
          </nav>
        )
      }
    >
      <p className={styles.release} data-docs-release="">{`Describes ${release.name} ${release.version}`}</p>
      <DocsArticle tree={article.tree} />
    </ContentTemplate>
  );
}
