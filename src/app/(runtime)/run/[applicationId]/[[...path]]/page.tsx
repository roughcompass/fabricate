import { notFound } from "next/navigation";
import { referenceTemplate, routeByPath } from "@/lib/demo/catalog";
import { requireDemo } from "@/lib/demo/guard";

/**
 * The application route in the address. The layout renders the application;
 * this page only rejects routes the application does not have.
 */
export default async function RunRoute({ params }: PageProps<"/run/[applicationId]/[[...path]]">) {
  requireDemo();
  const { applicationId, path = [] } = await params;
  if (path.length > 1) notFound();
  if (path.length === 1) {
    const template = referenceTemplate(applicationId);
    if (!template || !routeByPath(template.app, path[0]!)) notFound();
  }
  return null;
}
