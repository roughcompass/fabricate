import { FocusedHeader } from "@/components/shell/focused-header";
import { ShellHeader } from "@/components/shell/shell-header";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { openPreview } from "@/lib/previews/access";
import { routes } from "@/lib/web/routes";

/** A repository preview's shell header: Back to the Repository, in place of the sidebar controls (docs/previews.md). */
export default async function RepositoryPreviewHeader({ params }: PageProps<"/repositories/[repositoryId]/previews/[preview]">) {
  const { repositoryId, preview } = await params;
  const opened = openPreview(getDb(), getConfig(), preview);
  if (!opened || opened.repository.publicId !== repositoryId) return <ShellHeader />;
  const { repository } = opened;
  return (
    <FocusedHeader
      path={routes.repositoryPreview(repository.publicId, opened.preview.publicId)}
      focused={<ShellHeader back={{ href: `${routes.repository(repository.publicId)}#previews`, label: `Back to ${repository.name}` }} />}
      shell={<ShellHeader />}
    />
  );
}
