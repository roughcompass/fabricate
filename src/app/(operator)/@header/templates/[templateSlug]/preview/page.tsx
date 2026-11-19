import { FocusedHeader } from "@/components/shell/focused-header";
import { ShellHeader } from "@/components/shell/shell-header";
import { templateBySlug } from "@/lib/demo/catalog";
import { demoEnabled } from "@/lib/demo/guard";

/** Preview mode's shell header: Back to the template, in place of the sidebar controls (template-preview spec). */
export default async function PreviewHeader({ params }: PageProps<"/templates/[templateSlug]/preview">) {
  const { templateSlug } = await params;
  const template = demoEnabled() ? templateBySlug(templateSlug) : undefined;
  if (!template) return <ShellHeader />;
  return <FocusedHeader path={`/templates/${template.slug}/preview`} focused={<ShellHeader back={{ href: `/templates/${template.slug}`, label: `Back to ${template.title}` }} />} shell={<ShellHeader />} />;
}
