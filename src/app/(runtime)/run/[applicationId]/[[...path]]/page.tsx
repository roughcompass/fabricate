import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { findApplication } from "@/lib/demo/applications";
import { referenceTemplate, routeByPath, templateBySlug } from "@/lib/demo/catalog";
import { requireDemo } from "@/lib/demo/guard";

/**
 * The application route in the address. The layout renders the application;
 * this page only rejects routes the application does not have.
 */
export default async function RunRoute({ params }: { params: Promise<{ applicationId: string; path?: string[] }> }) {
  requireDemo();
  const { applicationId, path = [] } = await params;
  if (path.length > 1) notFound();
  if (path.length === 1) {
    const template = referenceTemplate(applicationId) ?? templateBySlug(findApplication(getDb(), applicationId)?.templateSlug ?? "");
    if (!template || !routeByPath(template.app, path[0]!)) notFound();
  }
  return null;
}
