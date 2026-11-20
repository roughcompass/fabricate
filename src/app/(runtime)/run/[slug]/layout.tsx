import type { Metadata } from "next";
import { applicationsAvailable } from "@/lib/applications/availability";
import { findApplication } from "@/lib/applications/records";
import { findSavedPreview } from "@/lib/applications/saved-previews";
import { getDb } from "@/lib/db/client";
import { parseRunSegment } from "@/lib/web/routes";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  if (!applicationsAvailable()) return {};
  const { slug, key } = parseRunSegment((await params).slug);
  const application = findApplication(getDb(), slug);
  const saved = application && key ? findSavedPreview(getDb(), application.publicId, key) : null;
  if (!application || (key && !saved)) return { title: "Page not found" };
  return { title: saved ? `${application.name} (${saved.label})` : application.name };
}

/** A running application, or one of its saved previews at `/run/<slug>@<key>` (add-applications, design decision 5): its page renders the build in a frame under the toolbar. */
export default function RunLayout({ children }: { children: React.ReactNode }) {
  return children;
}
