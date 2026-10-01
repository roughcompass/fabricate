import { NotFoundPage } from "@/components/shell/system-page";
import { demoEnabled } from "@/lib/demo/guard";

// While the demo is disabled, every page here answers not found; the page then links to Assessments.
export default function NotFound() {
  return <NotFoundPage noun="Template" sentenceNoun="template" listHref="/templates" listLabel="Salt Patterns" demo={demoEnabled()} />;
}
