import { redirect } from "next/navigation";

// The Assessments list is the home page (operator-interface/page-patterns spec,
// "Every link opens the page it names"). The redirect is temporary, so a later
// home page can take this address back.
export default function HomePage() {
  redirect("/assessments");
}
