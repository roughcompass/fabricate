import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { MediaCard } from "@/components/ui/media-card";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { StatGroup } from "@/components/ui/stat-group";
import { Severity, Status } from "@/components/ui/status";
import { ShortValue, Tag, TagList } from "@/components/ui/tag";
import { Row, Specimen } from "../specimen";
import styles from "../design-system.module.css";
import { DIGEST, HOUR, ago } from "./samples";
import { SURVEYOR_RELEASE_LABEL } from "@/lib/product";

/** Status, tags, sections, description lists, and stat groups. */
export function StatusSpecimens() {
  return (
    <>
      <Specimen
        id="status"
        title="Status and severity"
        description="A colored indicator and a label, never color alone. In-progress states pulse, and the states with no value differ by shape."
        render={() => (
          <>
            <Row label="Tones">
              <Status state="queued" />
              <Status state="analyzing" />
              <Status state="complete" />
              <Status state="complete_with_issues" />
              <Status state="failed" />
              <Status state="canceling" />
            </Row>
            <Row label="Outcomes">
              <Status state="meets" />
              <Status state="gap" />
              <Status state="indeterminate" />
              <Status state="not_applicable" />
            </Row>
            <Row label="No value">
              <Status state="unknown" />
              <Status state="absent" />
              <Status state="not_covered" />
            </Row>
            <Row label="Severity">
              <Severity value="critical" />
              <Severity value="high" />
              <Severity value="medium" />
              <Severity value="low" />
              <Severity value="info" />
            </Row>
          </>
        )}
      />

      <Specimen
        id="tags"
        title="Tags and copy"
        description="Identifiers, digests, commits, and URLs in the monospace face; long values are shortened with the whole value on hover and in the copy control."
        render={(theme) => (
          <>
            <Row label="Tags">
              <Tag>ini_hwfgmbqcnlhcyfs2</Tag>
              <Tag copy label="clone URL">
                https://git.example.com/acme/orders.git
              </Tag>
              <span data-copy-sample={theme === "light" ? "" : undefined}>
                <ShortValue value={DIGEST} label="digest" />
              </span>
            </Row>
            <Row label="Tag list">
              <TagList values={["Engineering baseline v1", "Service readiness v1"]} />
              <TagList values={[]} />
            </Row>
            <Row label="Copy button">
              <CopyButton value="asm_g81g3vozhwqqr8cu" label="Copy ID" />
            </Row>
          </>
        )}
      />

      <Specimen
        id="sections"
        title="Section and panel"
        description="Sections separate a page with headings and spacing. Panels are bordered containers for tables, forms, lists, and code, and never nest."
        render={() => (
          <>
            <Section title="Section heading" description="One sentence at most." actions={<Button size="sm">Action</Button>}>
              <p>Section content has no border of its own.</p>
            </Section>
            <Panel title="Panel" description="With a header, a body, and a footer." actions={<Button size="sm">Action</Button>} footer={<Button size="sm" variant="primary">Save changes</Button>}>
              <p>Panel content.</p>
            </Panel>
            <Panel title="Danger zone" tone="danger" footer={<Button size="sm" variant="danger" icon="trash">Delete Assessment</Button>}>
              <p>Only Assessments without Runs can be deleted.</p>
            </Panel>
          </>
        )}
      />

      <Specimen
        id="description-list"
        title="Description list"
        description="Rows put each term beside its value; columns put terms above values, for overviews. Plain inside a panel; on its own, on a surface."
        render={() => (
          <>
            <DescriptionList
              items={[
                ["Repositories", "6 selected Repositories"],
                ["Commit", <ShortValue key="commit" value={DIGEST} label="commit" />],
                ["Finished", null],
              ]}
            />
            <DescriptionList
              layout="columns"
              items={[
                ["Scope", "6 Repositories"],
                [SURVEYOR_RELEASE_LABEL, <Tag key="release">0.1.0</Tag>],
                ["Started", <RelativeTime key="started" value={ago(2 * HOUR)} />],
              ]}
            />
            <DescriptionList
              surface
              layout="columns"
              items={[
                ["Owner", "Platform engineering"],
                ["Repositories", "6 selected"],
                ["Created", <RelativeTime key="created" value={ago(30 * HOUR)} />],
              ]}
            />
            <DescriptionList
              surface
              items={[
                ["ID", <ShortValue key="id" value="ini_7f2c9a41d3e8b605" label="ID" />],
                ["Configuration digest", <ShortValue key="digest" value={DIGEST} label="digest" />],
              ]}
            />
          </>
        )}
      />

      <Specimen
        id="stat-group"
        title="Stat group"
        description="Key figures in one row, divided rather than boxed individually."
        render={() => (
          <StatGroup
            label="Outcomes"
            stats={[
              { label: "Gap", value: 16 },
              { label: "Indeterminate", value: 8 },
              { label: "Meets", value: 8, hint: "Across 2 Releases" },
              { label: "Relationship Map", value: "View", href: "#stat-group" },
            ]}
          />
        )}
      />
    </>
  );
}

/** Media cards, empty states, disclosures, and code blocks. */
export function ContentSpecimens() {
  return (
    <>
      <Specimen
        id="media-card"
        title="Media card"
        description="The title, two lines of description, and tags above an angled preview cropped by the card's edge. The title link covers the card."
        render={(theme) => (
          <div className={styles.cards}>
            <MediaCard
              title="Market watch"
              description="Follow instruments on a watchlist, chart prices, place orders, and track trades in J.P. Morgan Markets."
              image={{ src: "/specimens/placeholder-markets.svg", alt: "Preview of a markets portal" }}
              href={`/design-system?card=${theme}#media-card`}
              footer={
                <>
                  <Tag sans>Markets</Tag>
                  <Tag sans>DE Web</Tag>
                </>
              }
            />
            <MediaCard
              title="Unavailable card with a much longer title that wraps"
              description="Shown when a record cannot be opened. The description stays at two lines even when the text is long enough to need three or more lines to show in full."
              image={{ src: "/specimens/placeholder-other.svg", alt: "Preview of a workplace portal" }}
            />
          </div>
        )}
      />

      <Specimen
        id="media-card-states"
        title="Media card states"
        description="An application's card while its first build runs, when no build succeeded, and when its screenshot couldn't be taken. The status is in text with its icon and tone; the placeholder is hidden from assistive technology and still under reduced motion."
        render={(theme) => (
          <div className={styles.cards}>
            <MediaCard
              title="Orders portal"
              description="Order tracking for partners."
              image={{ state: "building" }}
              href={`/design-system?card=${theme}-building#media-card-states`}
              footer={
                <>
                  <Status state="building" size="sm" />
                  <Tag>main</Tag>
                </>
              }
            />
            <MediaCard
              title="Payments hub"
              description="Send and track payments."
              image={{ state: "failure" }}
              href={`/design-system?card=${theme}-failed#media-card-states`}
              footer={
                <>
                  <Status state="build_failed" size="sm" />
                  <Tag>main</Tag>
                </>
              }
            />
            <MediaCard
              title="Admin console"
              description="Manage users and access."
              image={{ state: "unavailable" }}
              href={`/design-system?card=${theme}-unavailable#media-card-states`}
              footer={
                <>
                  <Status state="ready" size="sm" />
                  <Tag>release/2.0</Tag>
                </>
              }
            />
          </div>
        )}
      />

      <Specimen
        id="empty-state"
        title="Empty state"
        description="A title, one sentence, and the action that fills the area."
        render={() => (
          <Panel flush>
            <EmptyState title="No Repositories yet" icon="git" action={<Button variant="primary" icon="plus">New Repository</Button>}>
              Register a Git repository or import a local directory.
            </EmptyState>
          </Panel>
        )}
      />

      <Specimen
        id="disclosure"
        title="Disclosure"
        description="Content that expands in place, as a panel or as a quiet toggle for secondary details."
        render={() => (
          <>
            <Disclosure summary="Runs continuous integration" aside={<span>3 Gap · 2 Meets</span>} defaultOpen>
              <p>Six Findings, one per repository.</p>
            </Disclosure>
            <Disclosure summary="Details" variant="plain">
              <p>{`${SURVEYOR_RELEASE_LABEL}, digests, and IDs.`}</p>
            </Disclosure>
          </>
        )}
      />

      <Specimen
        id="code-block"
        title="Code block"
        description="Cited lines with their numbers and a copy control; long lines wrap."
        render={() => <CodeBlock label="package.json" firstLine={3} code={'  "name": "orders",\n  "version": "1.0.0",\n  "packageManager": "pnpm@9.12.0+sha512.a-very-long-integrity-string-that-wraps-rather-than-scrolls"'} />}
      />
    </>
  );
}
