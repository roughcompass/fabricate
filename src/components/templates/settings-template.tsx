import { Page, PageHeader, type TemplateHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { SectionNav } from "@/components/ui/section-nav";
import { EmptyZone, FieldsSkeleton, HeaderSkeleton, type SpecimenOption, type TemplateEmpty, Zone, specimenHeader } from "./parts";
import styles from "./templates.module.css";

/** One group of configuration: a heading, one sentence, and its controls. */
export interface SettingsSection {
  id: string;
  title: string;
  /** One sentence. */
  description: React.ReactNode;
  content: React.ReactNode;
}

interface SettingsProps extends SpecimenOption {
  /** Breadcrumbs to the record and a title naming it, such as "Settings for web". */
  header: TemplateHeader<"settings">;
  alerts?: React.ReactNode;
  sections: readonly SettingsSection[];
  /** The danger section, last and the only home of destructive actions; each asks for confirmation, and for the record's name when it can't be undone. */
  danger?: { description: React.ReactNode; content: React.ReactNode };
  /** Shown in place of the sections when there's nothing to configure yet. */
  empty?: TemplateEmpty;
}

/** How many sections a Settings page has before a list of them shows beside them on wide viewports. */
const NAV_AFTER = 3;

/**
 * Settings (page-templates spec): configuration in sections, each with a
 * heading, one sentence, and its controls; a list of the sections beside
 * them on wide viewports when there are more than three; and a danger
 * section at the end. Modeled on Polaris's Settings and Cloudscape's delete
 * with additional confirmation.
 */
export function SettingsTemplate({ header, alerts, sections, danger, empty, specimen }: SettingsProps) {
  const all = [...sections.map(({ id, title }) => ({ id, label: title })), ...(danger ? [{ id: "danger-zone", label: "Danger zone" }] : [])];
  const body = (
    <div className={styles.settingsSections}>
      {sections.map((section) => (
        <Section key={section.id} id={section.id} title={section.title} description={section.description} level={specimen ? 3 : 2}>
          {section.content}
        </Section>
      ))}
      {danger && (
        <Section id={specimen ? undefined : "danger-zone"} title="Danger zone" description={danger.description} level={specimen ? 3 : 2}>
          <Panel tone="danger">{danger.content}</Panel>
        </Section>
      )}
    </div>
  );
  return (
    <Page>
      <PageHeader template="settings" {...header} alerts={alerts} {...specimenHeader(specimen)} />
      {empty ? (
        <EmptyZone empty={empty} />
      ) : all.length > NAV_AFTER ? (
        <div className={styles.settingsLayout}>
          <Zone name="section-nav">
            <SectionNav label="Settings" groups={[{ label: "Settings", items: all }]} />
          </Zone>
          <Zone name="sections">{body}</Zone>
        </div>
      ) : (
        <Zone name="sections">{body}</Zone>
      )}
    </Page>
  );
}

/** A Settings page while it loads: breadcrumbs, the title, and a section of fields. */
export function SettingsSkeleton() {
  return (
    <Page busy>
      <HeaderSkeleton breadcrumbs />
      <FieldsSkeleton fields={2} />
    </Page>
  );
}
