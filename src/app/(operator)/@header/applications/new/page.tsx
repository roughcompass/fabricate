import { FocusedHeader } from "@/components/shell/focused-header";
import { ShellHeader } from "@/components/shell/shell-header";
import { applicationsAvailable } from "@/lib/applications/availability";
import { getDb } from "@/lib/db/client";
import { isPublicId } from "@/lib/db/ids";
import { findRepository } from "@/lib/repositories/repository-records";
import { param } from "@/lib/web/query";
import { routes } from "@/lib/web/routes";
import { onboardingOrigin, originLabel } from "../../../applications/new/origin";

/** Onboarding's shell header: the back button to where it was opened, a Repository's page or Applications, in place of the sidebar controls (onboarding spec). */
export default async function NewApplicationHeader({ searchParams }: PageProps<"/applications/new">) {
  if (!applicationsAvailable()) return <ShellHeader />;
  const query = await searchParams;
  const from = param(query, "from");
  const repositoryId = param(query, "repository");
  const repository = from === "repository" && repositoryId && isPublicId(repositoryId, "src") ? findRepository(getDb(), repositoryId) : undefined;
  return (
    <FocusedHeader
      path={routes.newApplication()}
      focused={<ShellHeader back={{ href: onboardingOrigin(from, repository?.publicId), label: originLabel(from, repository?.name) }} />}
      shell={<ShellHeader />}
    />
  );
}
