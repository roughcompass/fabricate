import type { Metadata } from "next";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { prototypesRequest } from "@/lib/prototypes/request";
import { shellFormValues, workspaceShell } from "@/lib/prototypes/shell";
import { restoreShellAction, saveShellAction } from "./actions";
import { ShellForm } from "./shell-form";

export const metadata: Metadata = { title: "Page shell" };

const NOTICES: Record<string, { title: string; description: string }> = {
  saved: { title: "The page shell was saved.", description: "Page prototypes show it the next time they render. Share links and templates keep the shell they were made with." },
  restored: { title: "The default page shell is back.", description: "Page prototypes show it the next time they render." },
};

/**
 * The Page shell (page-shell spec, "The shell's contents are workspace
 * data"): the header, navigation, and footer every page prototype in the
 * workspace renders inside.
 */
export default async function PageShellPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db, workspace } = await prototypesRequest();
  const shell = await workspaceShell(db, workspace.id);
  const notice = (await searchParams).notice;
  const outcome = typeof notice === "string" ? NOTICES[notice] : undefined;
  return (
    <Page width="form">
      <OutcomeToast outcome={outcome ? { id: `shell:${notice}`, tone: "success", ...outcome } : undefined} strip={["notice"]} />
      <PageHeader
        breadcrumbs={[{ href: "/prototypes", label: "Prototypes" }]}
        title="Page shell"
        description="The header, navigation, and footer every page prototype renders inside. Generated pages write only their body, so changes here apply to every page at once."
        extraActions={
          <ConfirmDialog action={restoreShellAction} trigger={{ label: "Restore default", variant: "secondary" }} title="Restore the default page shell?" confirmLabel="Restore default">
            The application name, navigation, and footer go back to the fictional corporate banking portal every workspace starts with.
          </ConfirmDialog>
        }
      />
      <AiNotice />
      <ShellForm action={saveShellAction} initial={{ values: shellFormValues(shell), errors: {} }} />
    </Page>
  );
}
