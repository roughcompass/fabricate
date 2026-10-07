import { redirect } from "next/navigation";

/** Web Onboarding opens at its first list, the Portals. */
export default function OnboardingPage() {
  redirect("/onboarding/portals");
}
