import { Disclosure } from "@/components/ui/disclosure";
import { Page, PageHeader, type TemplateHeader } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyZone, HeaderSkeleton, type SpecimenOption, type TemplateEmpty, Zone, specimenHeader } from "./parts";
import styles from "./templates.module.css";

interface DocsProps extends SpecimenOption {
  variant?: "docs";
  /** The page's title, an optional one-sentence summary, and its only actions, Copy page and View as Markdown. */
  header: TemplateHeader<"content">;
  alerts?: React.ReactNode;
  /** The docs navigation: beside the article on wide viewports, a disclosure above it on narrow ones. */
  nav?: React.ReactNode;
  /** The label of the navigation's disclosure on narrow viewports. */
  navLabel?: string;
  /** The article's headings, beside it on wide viewports. */
  toc?: React.ReactNode;
  /** Shown in place of the article when the page has nothing to show. */
  empty?: TemplateEmpty;
  /** The article. */
  children?: React.ReactNode;
  /** Previous and next links. */
  pager?: React.ReactNode;
}

interface MarketingProps extends SpecimenOption {
  variant: "marketing";
  /** The hero: the page's title as its only `h1`, a lead, its calls to action, and a picture of the product. */
  hero: { title: string; lead: React.ReactNode; actions?: React.ReactNode; media?: React.ReactNode };
  /** Full-width sections, each heading stating its point. */
  children: React.ReactNode;
}

/**
 * Content (page-templates spec): reading. The docs variant puts the docs
 * navigation beside the article, then the article under the page header, a
 * list of its headings, and previous and next links. The marketing variant
 * is a hero followed by full-width sections. Modeled on Primer's page layout
 * and Cloudscape's hero header.
 */
export function ContentTemplate(props: DocsProps | MarketingProps) {
  if (props.variant === "marketing") {
    const { hero, children, specimen } = props;
    const Heading = specimen ? "h3" : "h1";
    return (
      <Page>
        <header className={styles.hero} data-page-header="" data-template="content">
          <div className={styles.heroText}>
            <Heading className={styles.heroTitle}>{hero.title}</Heading>
            <p className={styles.heroLead}>{hero.lead}</p>
            {hero.actions && <div className={styles.heroActions}>{hero.actions}</div>}
          </div>
          {hero.media && <div className={styles.heroMedia}>{hero.media}</div>}
        </header>
        <Zone name="sections" className={styles.marketingSections}>
          {children}
        </Zone>
      </Page>
    );
  }
  const { header, alerts, nav, navLabel = "Contents", toc, empty, children, pager, specimen } = props;
  const article = (
    <article className={styles.article}>
      <PageHeader template="content" {...header} alerts={alerts} {...specimenHeader(specimen)} />
      {empty ? <EmptyZone empty={empty} /> : children}
      {pager && <Zone name="pager">{pager}</Zone>}
    </article>
  );
  if (!nav && !toc) return <Page>{article}</Page>;
  return (
    <Page>
      <div className={styles.docsLayout} data-toc={toc ? "" : undefined}>
        {nav && (
          <>
            <div className={styles.navWide} data-zone="nav">
              {nav}
            </div>
            <div className={styles.navNarrow}>
              <Disclosure summary={navLabel} variant="plain">
                {nav}
              </Disclosure>
            </div>
          </>
        )}
        {article}
        {toc && (
          <div className={styles.toc} data-zone="toc">
            {toc}
          </div>
        )}
      </div>
    </Page>
  );
}

/** A Content page while it loads: the navigation, then the title and paragraphs. */
export function ContentSkeleton() {
  return (
    <Page busy>
      <div className={styles.docsLayout}>
        <div className={styles.navWide}>
          <Skeleton width="long" />
          <Skeleton width="medium" />
          <Skeleton width="long" />
        </div>
        <div className={styles.article}>
          <HeaderSkeleton description />
          <Skeleton />
          <Skeleton width="long" />
          <Skeleton />
        </div>
      </div>
    </Page>
  );
}
