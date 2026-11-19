import { Skeleton } from "@/components/ui/skeleton";
import { Page, PageHeader, type TemplateHeader } from "@/components/ui/page";
import { EmptyZone, FiguresSkeleton, HeaderSkeleton, type SpecimenOption, TableSkeleton, type TemplateEmpty, Zone, specimenHeader } from "./parts";
import styles from "./templates.module.css";

interface AnalysisProps extends SpecimenOption {
  /** Breadcrumbs, the title, and a meta row naming the scope and when the data was read. */
  header: TemplateHeader<"analysis">;
  /** Alerts on partial coverage, such as repositories in scope with no current Profile. */
  alerts?: React.ReactNode;
  /** A row of at most five key figures. */
  figures?: React.ReactNode;
  /** The filters, with a summary of those applied. */
  filters?: React.ReactNode;
  /** The chart, or the diagram, of the data. */
  chart?: React.ReactNode;
  /** Shown in place of the figures, chart, and table when there's nothing to analyze. */
  empty?: TemplateEmpty;
  /** A table of the same data, whose rows link to their records. */
  children?: React.ReactNode;
}

/**
 * Analysis (page-templates spec): aggregate figures with drill-down. The
 * page header, then alerts on partial coverage, a row of key figures,
 * filters with a summary of those applied, a chart, and a table of the same
 * data. Modeled on Fiori's analytical list page and Salt's analytical
 * dashboard.
 */
export function AnalysisTemplate({ header, alerts, figures, filters, chart, empty, children, specimen }: AnalysisProps) {
  return (
    <Page>
      <PageHeader template="analysis" {...header} alerts={alerts} {...specimenHeader(specimen)} />
      {empty ? (
        <EmptyZone empty={empty} />
      ) : (
        <>
          {figures && (
            <Zone name="figures">
              <div data-key-figures="">{figures}</div>
            </Zone>
          )}
          {filters && <Zone name="filters">{filters}</Zone>}
          {chart && <Zone name="chart">{chart}</Zone>}
          {children && <Zone name="table">{children}</Zone>}
        </>
      )}
    </Page>
  );
}

/** An Analysis page while it loads: its header, figures, filters, a chart, and the table. */
export function AnalysisSkeleton({ figures = 3 }: { figures?: number }) {
  return (
    <Page busy>
      <HeaderSkeleton breadcrumbs meta />
      {figures > 0 && <FiguresSkeleton count={figures} />}
      <Skeleton width="medium" height="control" />
      <span className={styles.chartSkeleton} aria-hidden="true" />
      <TableSkeleton rows={4} />
    </Page>
  );
}
