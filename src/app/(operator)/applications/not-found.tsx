import { NotFoundPage } from "@/components/shell/system-page";
import { demoEnabled } from "@/lib/demo/guard";

// While the demo is disabled, every page here answers not found; the page then links to Assessments.
export default function NotFound() {
  return <NotFoundPage noun="Application" sentenceNoun="application" listHref="/applications" listLabel="Applications" demo={demoEnabled()} />;
}
