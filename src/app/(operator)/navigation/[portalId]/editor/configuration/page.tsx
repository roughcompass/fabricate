import { redirect } from "next/navigation";
import { editorHref } from "../../../paths";

/** Portal Configuration opens on its first section. */
export default async function ConfigurationPage({ params }: { params: Promise<{ portalId: string }> }) {
  redirect(editorHref((await params).portalId, "configuration/brand"));
}
