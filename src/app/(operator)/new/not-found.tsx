import { homeLink, visibleSections } from "@/components/shell/navigation";
import { NotFoundPage } from "@/components/shell/system-page";
import { getConfig } from "@/lib/config";

// The create page answers not found only while the demo is disabled, so this
// page links to Home, which never belongs to the unavailable area.
export default function NotFound() {
  const home = homeLink(visibleSections(getConfig().demoEnabled));
  return <NotFoundPage noun="Page" listHref={home.href} listLabel={home.label} />;
}
