import type { Metadata } from "next";
import { AboutView } from "@/components/site/about-view";
import { ABOUT } from "@/content/about";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { siteFigures } from "@/lib/site/figures";

export const metadata: Metadata = { title: ABOUT.title, description: ABOUT.description };

/** The marketing page (product-site spec): the same for every reader, with figures read when it's served. */
export default function AboutPage() {
  return <AboutView figures={siteFigures(getDb(), getConfig())} />;
}
