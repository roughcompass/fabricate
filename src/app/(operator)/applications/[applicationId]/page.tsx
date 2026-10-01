import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ButtonLink } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-content";
import { CopyButton } from "@/components/ui/copy-button";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Icon } from "@/components/ui/icon";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { getDb } from "@/lib/db/client";
import { findOwnApplication } from "@/lib/demo/applications";
import { buildProgress } from "@/lib/demo/build";
import { BRANDS, routingLabel, templateBySlug } from "@/lib/demo/catalog";
import { applicationUrl, buildScriptFor, repositoryUrl } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { environmentLabel, resolveRouting } from "@/lib/demo/routing";
import { currentWorkspace } from "@/lib/demo/request";
import { skipBuildAction } from "../actions";
import { ENVIRONMENT_LABELS } from "../labels";
import { BuildLog } from "./build-log";
import styles from "../applications.module.css";

/** The time this request renders, which the build log's progress is measured against. */
function requestTime(): number {
  return Date.now();
}

async function ownApplication(applicationId: string) {
  const workspace = await currentWorkspace();
  return workspace ? findOwnApplication(getDb(), workspace.id, applicationId) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ applicationId: string }> }): Promise<Metadata> {
  const application = await ownApplication((await params).applicationId);
  return { title: application ? `${application.name} · Applications` : "Application not found" };
}

export default async function ApplicationPage({ params }: { params: Promise<{ applicationId: string }> }) {
  requireDemo();
  const application = await ownApplication((await params).applicationId);
  const template = application && templateBySlug(application.templateSlug);
  if (!application || !template) notFound();

  const brand = BRANDS[template.brand];
  const script = buildScriptFor(application, template);
  const now = requestTime();
  const progress = buildProgress(script, application.createdAt.getTime(), now, application.buildSkippedAt?.getTime() ?? null);
  const ready = progress.status === "ready";
  const url = applicationUrl(application);
  const routing = resolveRouting(template.app, application.environment);
  const repository = application.bitbucketProject && application.bitbucketRepository ? `${application.bitbucketProject}/${application.bitbucketRepository}` : null;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ href: "/applications", label: "Applications" }]}
        title={application.name}
        status={<Status state={progress.status} />}
        meta={[
          <Link key="template" href={`/templates/${template.slug}`}>
            {template.title}
          </Link>,
          brand.label,
          ENVIRONMENT_LABELS[application.environment],
          <span key="created">
            Created <RelativeTime value={application.createdAt} />
          </span>,
        ]}
        extraActions={
          !ready && (
            <ActionButton action={skipBuildAction} fields={{ application: application.publicId }} icon="play">
              Skip build
            </ActionButton>
          )
        }
        primaryAction={
          ready ? (
            <ButtonLink href={`/run/${application.publicId}`} target="_blank" rel="noopener" variant="primary" icon="arrowRight">
              Visit application
              <span className="visually-hidden"> (opens in a new tab)</span>
            </ButtonLink>
          ) : (
            <span className={styles.pendingAction}>
              <button type="button" className={buttonClass("primary")} disabled aria-describedby="visit-pending">
                <Icon name="arrowRight" size={16} />
                Visit application
              </button>
              <span id="visit-pending" className={styles.pendingNote}>
                Available when the build finishes
              </span>
            </span>
          )
        }
      />

      <DescriptionList
        items={[
          [
            "URL",
            <span key="url" className={styles.value}>
              <Tag>{url}</Tag>
              <CopyButton value={url} label="Copy URL" />
            </span>,
          ],
          ["Environment", ENVIRONMENT_LABELS[application.environment]],
          ["Template", `${template.title} ${template.version}`],
          ["Brand", `${brand.label} · ${brand.portalName}`],
          ...(repository
            ? ([
                [
                  "BitBucket repository",
                  <span key="repository" className={styles.value}>
                    <Tag>{repository}</Tag>
                    <CopyButton value={repositoryUrl(application.bitbucketProject!, application.bitbucketRepository!)} label="Copy repository location" />
                  </span>,
                ],
              ] as const)
            : []),
        ]}
      />

      <Section title="Microfrontends" description={`This application is a microfrontends group in the ${brand.portalName} portal.`}>
        <Panel flush>
          <Table
            label="Microfrontends group"
            head={
              <>
                <Th>Microfrontend</Th>
                <Th>Routing</Th>
                <Th>Version</Th>
                <Th>Environment</Th>
                <Th>Owner</Th>
              </>
            }
          >
            {template.app.members.map((member) => (
              <tr key={member.id}>
                <Td label="Microfrontend">
                  <Primary>{member.name}</Primary>
                  {member.role === "default" && <Secondary>Default application</Secondary>}
                </Td>
                <Td label="Routing">{routingLabel(member)}</Td>
                <Td label="Version">
                  <Tag>{routing[member.id]!.version}</Tag>
                </Td>
                <Td label="Environment">{environmentLabel(routing[member.id]!)}</Td>
                <Td label="Owner">{member.owner}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </Section>

      <Section title="Build log" description={ready ? "The simulated build and deployment that created this application." : "The build and deployment are simulated."}>
        {ready ? (
          <Disclosure summary={progress.skipped ? "Build completed (skipped ahead)" : "Build completed"} variant="panel">
            <BuildLog script={script} createdAt={application.createdAt.getTime()} skippedAt={application.buildSkippedAt?.getTime() ?? null} serverNow={now} />
          </Disclosure>
        ) : (
          <div className={styles.logPanel}>
            <BuildLog script={script} createdAt={application.createdAt.getTime()} skippedAt={application.buildSkippedAt?.getTime() ?? null} serverNow={now} />
          </div>
        )}
      </Section>
    </Page>
  );
}
