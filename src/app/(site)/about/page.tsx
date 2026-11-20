import type { Metadata } from "next";
import { AboutView } from "@/components/site/about-view";
import { ABOUT } from "@/content/about";
import { applicationsAvailable } from "@/lib/applications/availability";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { siteFigures } from "@/lib/site/figures";

// The browser title begins with the page's title, its hero's heading.
export const metadata: Metadata = { title: ABOUT.hero.title, description: ABOUT.description };

/** The marketing page (product-site spec): the same for every reader, with figures read when it's served, and Applications while they're available. */
export default function AboutPage() {
  const config = getConfig();
  return <AboutView figures={siteFigures(getDb(), config)} applications={applicationsAvailable(config)} />;
}
