import { routes } from "@/lib/web/routes";

/** Where onboarding's Cancel and back button go: the Repository page it was opened from, or Applications (onboarding spec). */
export function onboardingOrigin(from: string | undefined, repository: string | undefined): string {
  return from === "repository" && repository ? routes.repository(repository) : routes.applications;
}

/** The back button's name: Back to the Repository it was opened from, or to Applications. */
export function originLabel(from: string | undefined, repositoryName: string | undefined): string {
  return from === "repository" && repositoryName ? `Back to ${repositoryName}` : "Back to Applications";
}
