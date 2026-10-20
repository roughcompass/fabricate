import { redirect } from "next/navigation";
import { configurationHref } from "@/lib/portals/paths";

/** The configuration's own address opens its first section, Brand & identity. */
export default async function ConfigurationPage({ params }: { params: Promise<{ portalId: string }> }) {
  redirect(configurationHref((await params).portalId, "brand"));
}
