import type { Metadata } from "next";
import { applicationsAvailable } from "@/lib/applications/availability";
import { findApplication } from "@/lib/applications/records";
import { getDb } from "@/lib/db/client";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  if (!applicationsAvailable()) return {};
  const application = findApplication(getDb(), (await params).slug);
  return application ? { title: application.name } : { title: "Page not found" };
}

/** A running application (add-applications, design decision 5): its page renders the build in a frame under the toolbar. */
export default function RunLayout({ children }: { children: React.ReactNode }) {
  return children;
}
