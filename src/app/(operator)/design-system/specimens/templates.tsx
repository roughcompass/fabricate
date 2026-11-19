import Link from "next/link";
import { AnalysisSkeleton, AnalysisTemplate } from "@/components/templates/analysis-template";
import { ContentSkeleton, ContentTemplate } from "@/components/templates/content-template";
import { DashboardPanel, DashboardSkeleton, DashboardTemplate } from "@/components/templates/dashboard-template";
import { DetailsSkeleton, DetailsTemplate } from "@/components/templates/details-template";
import { EditorSkeleton, EditorTemplate } from "@/components/templates/editor-template";
import { FlowSkeleton, FlowTemplate } from "@/components/templates/flow-template";
import { FormSkeleton, FormTemplate } from "@/components/templates/form-template";
import { IndexSkeleton, IndexTemplate } from "@/components/templates/index-template";
import { PanelFailure } from "@/components/templates/panel-boundary";
import { SettingsSkeleton, SettingsTemplate } from "@/components/templates/settings-template";
import { SystemSkeleton, SystemTemplate } from "@/components/templates/system-template";
import { Button, ButtonLink } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DescriptionList } from "@/components/ui/description-list";
import { ChoiceGroup, HiddenFields, TextInput } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SearchField } from "@/components/ui/search-field";
import { StatGroup } from "@/components/ui/stat-group";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { TabLink, Tabs } from "@/components/ui/tabs";
import { discardFlowDemo } from "../actions";
import { Row, Specimen } from "../specimen";
import styles from "../design-system.module.css";

/** The gallery's specimen entries for the page templates, in the order the design system lists them. */
export const TEMPLATE_SECTIONS: [id: string, title: string][] = [
  ["template-dashboard", "Dashboard template"],
  ["template-index", "Index template"],
  ["template-details", "Details template"],
  ["template-analysis", "Analysis template"],
  ["template-form", "Form template"],
  ["template-flow", "Flow template"],
  ["template-editor", "Editor template"],
  ["template-settings", "Settings template"],
  ["template-content", "Content template"],
  ["template-system", "System template"],
];

const HERE = "/design-system";
const crumbs = (...labels: string[]) => labels.map((label) => ({ href: "#templates", label }));

const REPOSITORIES = [
  { name: "web", url: "file:///fleet/web", version: 3 },
  { name: "orders", url: "file:///fleet/orders", version: 1 },
];

function RepositoriesTable() {
  return (
    <Panel flush>
      <Table
        label="Repositories"
        head={
          <>
            <Th>Name</Th>
            <Th>Profile</Th>
          </>
        }
      >
        {REPOSITORIES.map((repository) => (
          <tr key={repository.name}>
            <Td label="Name">
              <Primary>
                <Link href="#template-index">{repository.name}</Link>
              </Primary>
              <Secondary>{repository.url}</Secondary>
            </Td>
            <Td label="Profile">{`Version ${repository.version}`}</Td>
          </tr>
        ))}
      </Table>
    </Panel>
  );
}

/** One template's example, its empty state, and its loading state; a System page shows its two conditions in place of the example and the empty state. */
function States({ example, empty, loading, labels = ["Example", "Empty"] }: { example: React.ReactNode; empty?: React.ReactNode; loading: React.ReactNode; labels?: [string, string] }) {
  return (
    <>
      <Row label={labels[0]}>
        <div className={styles.templateFrame}>{example}</div>
      </Row>
      {empty && (
        <Row label={labels[1]}>
          <div className={styles.templateFrame}>{empty}</div>
        </Row>
      )}
      <Row label="Loading">
        <div className={styles.templateFrame}>{loading}</div>
      </Row>
    </>
  );
}

/** A reviewed value and the link back to the step that sets it. */
function ReviewValue({ value, href, change }: { value: string; href: string; change: string }) {
  return (
    <span className={styles.rowItems}>
      <span>{value}</span>
      <Link href={href}>{change}</Link>
    </span>
  );
}

/** The Flow template's three-step example: values travel in the address, so it works without JavaScript. */
function FlowExample({ theme, step, values }: { theme: "light" | "dark"; step: number; values: { name: string; kind: string } }) {
  const form = `${theme}-flow-form`;
  const steps = ["Details", "Kind", "Review"];
  const kept = (except: "name" | "kind" | null) => ({ flowName: except === "name" ? null : values.name || null, flowKind: except === "kind" ? null : values.kind || null });
  const changeHref = (target: number) => `${HERE}?${new URLSearchParams({ flowStep: String(target), ...(values.name && { flowName: values.name }), ...(values.kind && { flowKind: values.kind }) })}#template-flow`;
  return (
    <FlowTemplate
      specimen
      header={{ breadcrumbs: crumbs("Repositories"), title: "Add a Repository" }}
      steps={steps}
      current={step}
      footer={
        <>
          <ConfirmDialog action={discardFlowDemo} trigger={{ label: "Cancel", variant: "tertiary" }} title="Discard this Repository?" confirmLabel="Discard Repository">
            <p>The values entered so far are lost.</p>
          </ConfirmDialog>
          {step > 1 && (
            <button type="submit" form={form} name="flowStep" value={step - 1} {...buttonProps("secondary")}>
              Previous
            </button>
          )}
          {step < steps.length ? (
            <button type="submit" form={form} name="flowStep" value={step + 1} {...buttonProps("primary")}>
              Next
            </button>
          ) : (
            <Button variant="primary" icon="plus">
              Add Repository
            </Button>
          )}
        </>
      }
    >
      <form id={form} action={`${HERE}#template-flow`} method="get" className={styles.stack}>
        {step === 1 && (
          <>
            <HiddenFields values={kept("name")} />
            <TextInput id={`${theme}-flow-name`} name="flowName" label="Name" defaultValue={values.name} />
          </>
        )}
        {step === 2 && (
          <>
            <HiddenFields values={kept("kind")} />
            <ChoiceGroup
              id={`${theme}-flow-kind`}
              name="flowKind"
              legend="Kind"
              type="radio"
              selected={[values.kind || "web"]}
              choices={[
                { value: "web", label: "Web application" },
                { value: "library", label: "Library" },
              ]}
            />
          </>
        )}
        {step === 3 && (
          <>
            <HiddenFields values={kept(null)} />
            <DescriptionList
              items={[
                ["Name", <ReviewValue key="name" value={values.name || "Not entered"} href={changeHref(1)} change="Change name" />],
                ["Kind", <ReviewValue key="kind" value={values.kind === "library" ? "Library" : "Web application"} href={changeHref(2)} change="Change kind" />],
              ]}
            />
          </>
        )}
      </form>
    </FlowTemplate>
  );
}

/** Each of the ten page templates (page-templates spec), with its empty and loading states, in both themes. */
export function TemplateSpecimens({ flow }: { flow: { step: number; name: string; kind: string } }) {
  return (
    <>
      <RecordTemplates />
      <TaskTemplates flow={flow} />
      <ReadingTemplates />
    </>
  );
}

/** Dashboard, Index, Details, and Analysis: the templates that present records. */
function RecordTemplates() {
  return (
    <>
      <Specimen
        id="template-dashboard"
        title="Dashboard template"
        description="A landing page: the header with one primary action, alerts, what needs attention, a row of key figures, and a grid of panels that each link to their list and fail on their own."
        stacked
        render={() => (
          <States
            example={
              <DashboardTemplate
                specimen
                header={{ title: "Home", description: "Where the fleet stands.", primaryAction: <Button variant="primary" icon="plus">New Assessment</Button> }}
                figures={<StatGroup label="Fleet" stats={[{ label: "Repositories", value: 62 }, { label: "Profiled", value: 58 }, { label: "Assessments", value: 4 }]} />}
              >
                <DashboardPanel title="Recent activity" link={{ href: "#template-dashboard", label: "All Assessments" }}>
                  <p>Run #4 finished.</p>
                </DashboardPanel>
                <DashboardPanel title="Assessment trend" link={{ href: "#template-dashboard", label: "All Assessments" }}>
                  <PanelFailure title="Assessment trend" />
                </DashboardPanel>
              </DashboardTemplate>
            }
            empty={<DashboardTemplate specimen header={{ title: "Home", description: "Where the fleet stands." }} empty={{ title: "Nothing to summarize yet", icon: "git", children: "Add Repositories to see where the fleet stands.", action: <Button>Add Repositories</Button> }} />}
            loading={<DashboardSkeleton figures={3} />}
          />
        )}
      />

      <Specimen
        id="template-index"
        title="Index template"
        description="A collection: the header with one primary action that adds, view tabs with counts, the filter bar with the count, the table or cards, and pagination."
        stacked
        render={(theme) => (
          <States
            example={
              <IndexTemplate
                specimen
                header={{ title: "Repositories", primaryAction: <Button variant="primary" icon="plus">New Repository</Button> }}
                filters={
                  <div className={styles.rowItems}>
                    <p>2 Repositories</p>
                    <SearchField id={`${theme}-template-search`} name="q" label="Search Repositories" hideLabel size="sm" placeholder="Search by name" />
                  </div>
                }
              >
                <RepositoriesTable />
              </IndexTemplate>
            }
            empty={<IndexTemplate specimen header={{ title: "Repositories" }} empty={{ title: "No Repositories yet", icon: "git", children: "Register Git repositories to profile and assess them.", action: <Button variant="primary" icon="plus">New Repository</Button> }} />}
            loading={<IndexSkeleton filters />}
          />
        )}
      />

      <Specimen
        id="template-details"
        title="Details template"
        description="One record: breadcrumbs, its name with status and actions, a meta row, and its view tabs; then the selected view, the overview first. A hub previews five related records per section."
        stacked
        render={() => (
          <States
            example={
              <DetailsTemplate
                specimen
                header={{
                  breadcrumbs: crumbs("Repositories"),
                  title: "web",
                  status: <Status state="complete" />,
                  meta: ["Version 3", "Profiled 2 hours ago"],
                  secondaryActions: [{ href: "#template-details", label: "Settings", icon: "settings" }],
                  tabs: (
                    <Tabs label="Profile views">
                      <TabLink href="#template-details" active>
                        Overview
                      </TabLink>
                      <TabLink href="#template-details" active={false}>
                        Dependencies
                      </TabLink>
                    </Tabs>
                  ),
                }}
                related={[{ title: "Used by", records: REPOSITORIES.map((repository) => ({ key: repository.name, content: <Link href="#template-details">{repository.name}</Link> })), all: { href: "#template-details", noun: "Repositories", singular: "Repository" } }]}
              >
                <StatGroup label="Scope" stats={[{ label: "Files read", value: 412 }, { label: "Dependencies", value: 38 }]} />
              </DetailsTemplate>
            }
            empty={<DetailsTemplate specimen header={{ breadcrumbs: crumbs("Repositories"), title: "web" }} empty={{ title: "Not profiled yet", icon: "clock", children: "Its Profile appears here once the repository has been read." }} />}
            loading={<DetailsSkeleton tabs={3} />}
          />
        )}
      />

      <Specimen
        id="template-analysis"
        title="Analysis template"
        description="Aggregates with drill-down: breadcrumbs, a meta row naming the scope and when it was read, alerts on partial coverage, key figures, filters, a chart, and a table of the same data."
        stacked
        render={() => (
          <States
            example={
              <AnalysisTemplate
                specimen
                header={{ breadcrumbs: crumbs("Adoption"), title: "Salt Design System", meta: ["62 Repositories", "Read 2 hours ago"] }}
                figures={<StatGroup label="Adoption" stats={[{ label: "Components tracked", value: 72 }, { label: "Used", value: 41 }, { label: "Total usages", value: "3,118" }]} />}
              >
                <RepositoriesTable />
              </AnalysisTemplate>
            }
            empty={<AnalysisTemplate specimen header={{ breadcrumbs: crumbs("Adoption"), title: "Salt Design System" }} empty={{ title: "No usage yet", icon: "network", children: "No current Profile uses this design system." }} />}
            loading={<AnalysisSkeleton />}
          />
        )}
      />

    </>
  );
}

/** Form, Flow, Editor, and Settings: the templates for tasks. */
function TaskTemplates({ flow }: { flow: { step: number; name: string; kind: string } }) {
  return (
    <>
      <Specimen
        id="template-form"
        title="Form template"
        description="Create, edit, or publish on one page: breadcrumbs and a title naming the task, no header actions, the form's sections, and a footer with Cancel and the submit action."
        stacked
        render={(theme) => (
          <States
            example={
              <FormTemplate specimen header={{ breadcrumbs: crumbs("Repositories"), title: "New Repository" }}>
                <Panel
                  footer={
                    <>
                      <ButtonLink href="#template-form">Cancel</ButtonLink>
                      <Button variant="primary">Create Repository</Button>
                    </>
                  }
                >
                  <TextInput id={`${theme}-template-form-url`} label="Clone URL" />
                </Panel>
              </FormTemplate>
            }
            empty={<FormTemplate specimen header={{ breadcrumbs: crumbs("Assessments"), title: "New Assessment" }} empty={{ title: "No Repositories to assess", icon: "git", children: "An Assessment needs at least one Repository.", action: <Button>Add Repositories</Button> }} />}
            loading={<FormSkeleton />}
          />
        )}
      />

      <Specimen
        id="template-flow"
        title="Flow template"
        description="A task of three to five steps: the title stays on every step, the indicator shows where you are, and the last step reviews every value with a link to change it."
        stacked
        render={(theme) => (
          <States
            example={<FlowExample theme={theme} step={flow.step} values={flow} />}
            empty={
              <FlowTemplate
                specimen
                header={{ breadcrumbs: crumbs("Assessments"), title: "Start an Assessment" }}
                steps={["Scope", "Releases", "Review"]}
                current={1}
                empty={{ title: "No Repositories to assess", icon: "git", children: "An Assessment needs at least one Repository.", action: <Button>Add Repositories</Button> }}
              />
            }
            loading={<FlowSkeleton />}
          />
        )}
      />

      <Specimen
        id="template-editor"
        title="Editor template"
        description="Authoring: the title with its status, validation alerts, the editing area, and a sticky bar for save and publish. Its focused variant gives the column to one subject, with a back button in the shell header."
        stacked
        render={() => (
          <States
            example={
              <EditorTemplate
                specimen
                header={{ breadcrumbs: crumbs("Standards", "Engineering baseline"), title: "Engineering baseline draft", status: <Status state="draft_problems" label="3 issues" />, secondaryActions: [{ href: "#template-editor", label: "View published", icon: "eye" }] }}
                saveBar={
                  <div className={styles.rowItems}>
                    <span>All changes saved</span>
                    <Button>Save draft</Button>
                    <Button variant="primary">Review and publish</Button>
                  </div>
                }
              >
                <Panel title="Runs continuous integration">
                  <p>A Control&apos;s condition, built from fields and operators.</p>
                </Panel>
              </EditorTemplate>
            }
            empty={<EditorTemplate specimen header={{ breadcrumbs: crumbs("Standards"), title: "Engineering baseline draft" }} empty={{ title: "No Controls yet", icon: "checklist", children: "Add a Control to describe what Evaluations check.", action: <Button icon="plus">Add Control</Button> }} />}
            loading={<EditorSkeleton />}
          />
        )}
      />

      <Specimen
        id="template-settings"
        title="Settings template"
        description="Configuration in sections, each with a heading, one sentence, and its controls; a list of sections beside them when there are more than three; destructive actions only in the danger section, last."
        stacked
        render={(theme) => (
          <States
            example={
              <SettingsTemplate
                specimen
                header={{ breadcrumbs: crumbs("Repositories", "web"), title: "Settings for web" }}
                sections={[{ id: `${theme}-settings-general`, title: "General", description: "Changes apply to Runs started afterward.", content: <TextInput id={`${theme}-template-settings-name`} label="Name" defaultValue="web" /> }]}
                danger={{ description: "Actions here can't be undone.", content: <Button variant="danger" icon="trash">Delete Repository</Button> }}
              />
            }
            empty={<SettingsTemplate specimen header={{ breadcrumbs: crumbs("Admin"), title: "Settings" }} sections={[]} empty={{ title: "Nothing to configure yet", icon: "settings", children: "Settings appear here once there's something to change." }} />}
            loading={<SettingsSkeleton />}
          />
        )}
      />

    </>
  );
}

/** Content and System: reading, and conditions. */
function ReadingTemplates() {
  return (
    <>
      <Specimen
        id="template-content"
        title="Content template"
        description="Reading: the docs navigation beside the article, its headings, and previous and next links; or the marketing page's hero and full-width sections."
        stacked
        render={() => (
          <States
            example={
              <ContentTemplate
                specimen
                header={{ title: "Add your repository", description: "Register a repository once; the Frontend Registry surveys it whenever it changes." }}
                nav={
                  <ul className={styles.index} aria-label="Docs">
                    <li>
                      <Link href="#template-content">Get started</Link>
                    </li>
                    <li>
                      <Link href="#template-content">Concepts</Link>
                    </li>
                  </ul>
                }
                pager={<Link href="#template-content">Next: Find a repository</Link>}
              >
                <p>Every fact comes from committed files, read as data.</p>
              </ContentTemplate>
            }
            empty={<ContentTemplate specimen header={{ title: "Add your repository" }} empty={{ title: "This page has no content yet", icon: "file", children: "Its Markdown file is empty." }} />}
            loading={<ContentSkeleton />}
          />
        )}
      />

      <Specimen
        id="template-system"
        title="System template"
        description="A condition: a title naming it, one sentence, and one way back to the nearest list, plus Try again for errors. No breadcrumbs, meta row, or tabs."
        stacked
        render={() => (
          <States
            example={
              <SystemTemplate specimen title="Run not found" actions={<ButtonLink href="#template-system" variant="primary">Go to Assessments</ButtonLink>}>
                <p>This Run does not exist. It may have been deleted, or the address may be mistyped.</p>
              </SystemTemplate>
            }
            empty={
              <SystemTemplate
                specimen
                icon="alert"
                title="Something went wrong"
                actions={
                  <>
                    <Button variant="primary">Try again</Button>
                    <ButtonLink href="#template-system">Go to Home</ButtonLink>
                  </>
                }
              >
                <p>This page could not be shown. Trying again often works.</p>
              </SystemTemplate>
            }
            loading={<SystemSkeleton />}
            labels={["Not found", "Error"]}
          />
        )}
      />
    </>
  );
}
