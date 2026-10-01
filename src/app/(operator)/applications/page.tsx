import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { MenuItem } from "@/components/ui/menu";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status } from "@/components/ui/status";
import { Primary, RowActions, Table, Td, Th } from "@/components/ui/table";
import { getDb } from "@/lib/db/client";
import { listApplications } from "@/lib/demo/applications";
import { buildProgress } from "@/lib/demo/build";
import { BRANDS, templateBySlug } from "@/lib/demo/catalog";
import { buildScriptFor } from "@/lib/demo/deployments";
import { requireDemo } from "@/lib/demo/guard";
import { currentWorkspace } from "@/lib/demo/request";
import { demoOutcome } from "../templates/outcomes";
import { deleteApplicationAction } from "./actions";
import { ENVIRONMENT_LABELS } from "./labels";

export const metadata: Metadata = { title: "Applications" };

/** The time this request renders, which each build's status is measured against. */
function requestTime(): number {
  return Date.now();
}

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  requireDemo();
  const params = await searchParams;
  const workspace = await currentWorkspace();
  const db = getDb();
  const now = requestTime();
  const applications = (workspace ? listApplications(db, workspace.id) : []).flatMap((application) => {
    const template = templateBySlug(application.templateSlug);
    if (!template) return [];
    const status = buildProgress(buildScriptFor(application, template), application.createdAt.getTime(), now, application.buildSkippedAt?.getTime() ?? null).status;
    return [{ application, template, status }];
  });

  return (
    <Page>
      <PageHeader
        breadcrumbs={[{ href: "/templates", label: "Templates" }]}
        title="Applications"
        description="Applications you created from templates in this browser. Their builds and deployments are simulated."
        primaryAction={
          <ButtonLink href="/templates" variant="primary" icon="plus">
            Start with a template
          </ButtonLink>
        }
        alerts={<OutcomeToast outcome={demoOutcome(param(params, "notice"))} strip={["notice"]} />}
      />

      <Panel flush>
        {applications.length > 0 ? (
          <Table
            label="Applications"
            head={
              <>
                <Th>Name</Th>
                <Th>Template</Th>
                <Th>Brand</Th>
                <Th>Environment</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {applications.map(({ application, template, status }) => (
              <tr key={application.publicId}>
                <Td label="Name">
                  <Primary>
                    <Link href={`/applications/${application.publicId}`}>{application.name}</Link>
                  </Primary>
                </Td>
                <Td label="Template">{template.title}</Td>
                <Td label="Brand">{BRANDS[template.brand].label}</Td>
                <Td label="Environment">{ENVIRONMENT_LABELS[application.environment]}</Td>
                <Td label="Status">
                  <Status state={status} />
                </Td>
                <Td label="Created">
                  <RelativeTime value={application.createdAt} />
                </Td>
                <Td align="actions">
                  <RowActions>
                    <ConfirmDialog
                      action={deleteApplicationAction}
                      fields={{ application: application.publicId }}
                      trigger={{ label: "Delete application", icon: "trash" }}
                      menu={{
                        label: `Actions for ${application.name}`,
                        items: (
                          <MenuItem href={`/run/${application.publicId}`} icon="arrowRight" newTab>
                            Visit application
                          </MenuItem>
                        ),
                      }}
                      title={`Delete ${application.name}?`}
                      confirmLabel="Delete application"
                      tone="danger"
                    >
                      <p>Its comments and share links are removed too.</p>
                    </ConfirmDialog>
                  </RowActions>
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState
            title="No applications yet"
            icon="layers"
            action={
              <ButtonLink href="/templates" variant="primary">
                Browse templates
              </ButtonLink>
            }
          >
            Deploy a template to create your first application.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
