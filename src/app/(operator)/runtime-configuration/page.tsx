import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { PORTALS_HREF, editorHref } from "@/lib/portals/paths";
import { rememberedPortal } from "@/lib/web/portal-cookie";

/**
 * Runtime Configuration in the primary menu (runtime-configuration spec,
 * "Runtime Configuration opens the current Portal's configuration"): the
 * current Portal's Experience Editor, or the Portals page with All Portals
 * current.
 */
export default async function RuntimeConfigurationPage(): Promise<never> {
  const current = await rememberedPortal(getDb());
  redirect(current ? editorHref(current.publicId) : PORTALS_HREF);
}
