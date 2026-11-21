import { PAGE_SIZE, allApplications } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";
import { routes } from "@/lib/web/routes";

/** The Applications page at the page that shows the new application's card, with the notice +notice+. */
export function createdAddress(slug: string, notice = "created"): string {
  const position = allApplications(getDb()).findIndex((application) => application.slug === slug);
  const page = Math.floor(Math.max(0, position) / PAGE_SIZE) + 1;
  return `${routes.applications}?${new URLSearchParams({ ...(page > 1 && { page: String(page) }), notice, application: slug })}`;
}
