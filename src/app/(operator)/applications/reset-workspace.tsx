import { redirect } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Outcome } from "@/components/ui/outcome-toast";
import { Section } from "@/components/ui/section";
import { requireApplications } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { currentWorkspace } from "@/lib/demo/request";
import { resetWorkspace } from "@/lib/demo/workspaces";
import { withQuery } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";

/** The notice Reset workspace redirects to Applications with. */
const RESET = "workspace-reset";

/**
 * Clears the visitor's workspace (template-demo/demo-mode spec, "Visitors can
 * reset their workspace's comments and share links"): its comment threads,
 * its share links, which stop working, and its display name, and restores
 * its guidance state. Applications and other workspaces are untouched.
 * @public ResetWorkspaceSection submits it; tests call it directly.
 */
export async function resetWorkspaceAction(): Promise<void> {
  "use server";
  requireApplications();
  const workspace = await currentWorkspace();
  if (workspace) resetWorkspace(getDb(), workspace.id);
  redirect(withQuery(routes.applications, { notice: RESET }));
}

/**
 * Reset workspace, the Applications page's last section (page-patterns spec,
 * "No destructive actions in the header"): a destructive action, so it
 * confirms first, and Cancel changes nothing. It redirects to Applications
 * with the notice `workspace-reset`, which `workspaceOutcome` turns into a
 * toast.
 */
export function ResetWorkspaceSection() {
  return (
    <Section title="Reset workspace" description="Removes your comments and share links, forgets your display name, and shows the guided hints again. Applications and other visitors' work aren't affected.">
      <div>
        <ConfirmDialog action={resetWorkspaceAction} trigger={{ label: "Reset workspace", icon: "undo" }} title="Reset your workspace?" confirmLabel="Reset workspace" tone="danger">
          {"Your comments and share links are removed, and links you shared stop working. Applications and other visitors' work aren't affected."}
        </ConfirmDialog>
      </div>
    </Section>
  );
}

/**
 * The toast for Reset workspace's notice, or undefined for any other code.
 */
export function workspaceOutcome(code: string | undefined): Outcome | undefined {
  return code === RESET ? { id: RESET, tone: "success", title: "Your workspace was reset.", description: "Your comments and share links were removed, and links you shared no longer open." } : undefined;
}
