import Link from "next/link";
import { countLabel } from "@/components/ui/count";
import { Page, PageHeader, type TemplateHeader } from "@/components/ui/page";
import { Section } from "@/components/ui/section";
import { EmptyZone, FiguresSkeleton, HeaderSkeleton, type SpecimenOption, TableSkeleton, type TemplateEmpty, Zone, specimenHeader } from "./parts";
import styles from "./templates.module.css";

/** A hub's section of related records: at most five previewed, and a link to all of them. */
export interface RelatedRecords {
  title: string;
  /** Every related record, for the count; only the first five show. */
  records: readonly { key: string; content: React.ReactNode }[];
  /** The page that lists all of them, and its noun for the link, such as "Repositories". */
  all: { href: string; noun: string; singular: string };
  empty?: string;
}

/** How many related records a hub previews per section (page-templates spec, Details). */
export const HUB_PREVIEW = 5;

interface DetailsProps extends SpecimenOption {
  /** Breadcrumbs, the record's name with its status and actions, a meta row, and its view tabs. */
  header: TemplateHeader<"details">;
  alerts?: React.ReactNode;
  /** The hub variant's sections of related records, after the overview. */
  related?: readonly RelatedRecords[];
  /** Shown in place of the view when the record has nothing to show yet. */
  empty?: TemplateEmpty;
  /** The selected view; the first view is the record's overview. */
  children?: React.ReactNode;
}

/**
 * Details (page-templates spec): one record, plain, with view tabs (the
 * header's `tabs`), or as a hub of related records. The page header, then
 * alerts and the selected view, the overview first. An action that applies to
 * one view sits in that view. Modeled on Cloudscape's details pages and
 * Fiori's object page.
 */
export function DetailsTemplate({ header, alerts, related, empty, children, specimen }: DetailsProps) {
  return (
    <Page>
      <PageHeader template="details" {...header} alerts={alerts} {...specimenHeader(specimen)} />
      {empty ? <EmptyZone empty={empty} /> : children}
      {related?.map((section) => (
        <Zone key={section.title} name="related">
          <Section
            title={section.title}
            description={countLabel(section.records.length, section.all.singular, section.all.noun)}
            actions={section.records.length > HUB_PREVIEW && <Link href={section.all.href}>{`All ${section.all.noun}`}</Link>}
          >
            {section.records.length > 0 ? (
              <ul className={styles.related}>
                {section.records.slice(0, HUB_PREVIEW).map((record) => (
                  <li key={record.key}>{record.content}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>{section.empty ?? `No ${section.all.noun} yet.`}</p>
            )}
          </Section>
        </Zone>
      ))}
    </Page>
  );
}

/** A Details page while it loads: breadcrumbs, the title row and meta row, view tabs if it has them, an overview, and a table. */
export function DetailsSkeleton({ tabs = 0, actions = 2 }: { tabs?: number; actions?: number }) {
  return (
    <Page busy>
      <HeaderSkeleton breadcrumbs actions={actions} meta tabs={tabs} />
      <FiguresSkeleton count={4} />
      <TableSkeleton rows={5} />
    </Page>
  );
}
