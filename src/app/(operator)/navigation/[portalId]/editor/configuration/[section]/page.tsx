import { notFound } from "next/navigation";
import { ConfigurationView } from "@/components/experience/configuration-view";
import { CONFIGURATION_SECTIONS } from "@/lib/experience/sections";

/** A Portal Configuration section, at its own address (portal-configuration spec). */
export default async function ConfigurationSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!CONFIGURATION_SECTIONS.some((candidate) => candidate.id === section)) notFound();
  return <ConfigurationView section={section} />;
}
