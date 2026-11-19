import type { MediaCardImage } from "@/components/ui/media-card";
import { Status } from "@/components/ui/status";
import { screenshotAlt } from "@/lib/applications/images";
import type { Application } from "@/lib/applications/records";
import { APPLICATION_STATUS_LABELS, type ApplicationStatus } from "@/lib/applications/status";
import { routes } from "@/lib/web/routes";

/**
 * How applications show on their pages (applications/catalog spec): the
 * image for a card or a page, the status with its icon and tone, and what
 * the package is built with.
 */

/** The status's entry in the status registry: an application that can't be previewed is an error, unlike a commit refused on a Repository's page. */
const STATUS_STATES: Readonly<Record<ApplicationStatus, string>> = {
  ready: "ready",
  building: "building",
  build_failed: "build_failed",
  not_previewable: "cant_be_previewed",
  latest_build_failed: "latest_build_failed",
  latest_not_previewable: "latest_not_previewable",
};

/** The application's status, in text with its icon and tone. */
export function ApplicationStatusLabel({ application, size }: { application: Pick<Application, "status">; size?: "sm" | "md" }) {
  return <Status state={STATUS_STATES[application.status]} label={APPLICATION_STATUS_LABELS[application.status]} size={size} />;
}

/** What the image area shows: the current build's screenshot, or the card image, or the state in its place. */
export function applicationImage(application: Application, size: "full" | "card"): MediaCardImage {
  switch (application.image) {
    case "screenshot":
      return { src: routes.applicationScreenshot(application.slug, application.screenshot!.version, size), alt: screenshotAlt(application) };
    case "placeholder":
    case "capturing":
      return { state: "building" };
    case "failure":
      return { state: "failure" };
    case "unavailable":
      return { state: "unavailable" };
  }
}

/** Its frameworks and build tool, "React · Vite", and with +packageManager+ its package manager too; null before its commit was decided. */
export function traitsLabel(application: Pick<Application, "facts">, packageManager = false): string | null {
  const { frameworks, buildTool } = application.facts;
  const parts = [...frameworks, ...(buildTool ? [buildTool] : []), ...(packageManager && application.facts.packageManager ? [application.facts.packageManager] : [])];
  return parts.length ? parts.join(" · ") : null;
}
