import { NotFoundPage } from "@/components/shell/system-page";
import { applicationsAvailable } from "@/lib/applications/availability";

// While previews are off, every page here answers not found, and the page links Home, not to Applications (page-patterns spec).
export default function NotFound() {
  return <NotFoundPage noun="Application" sentenceNoun="application" listHref="/applications" listLabel="Applications" demo={applicationsAvailable()} />;
}
