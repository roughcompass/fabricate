import { redirect } from "next/navigation";
import { editorHref } from "@/lib/portals/paths";

/** The editor opens on Frame Zones (experience-editor spec, "An icon rail switches between four views"). */
export default async function ExperienceEditorPage({ params }: { params: Promise<{ portalId: string }> }) {
  redirect(editorHref((await params).portalId));
}
