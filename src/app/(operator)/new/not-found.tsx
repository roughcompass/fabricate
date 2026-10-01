import { NotFoundPage } from "@/components/shell/system-page";

// The create page answers not found only while the demo is disabled, so this
// page links to a list that always exists.
export default function NotFound() {
  return <NotFoundPage noun="Page" listHref="/assessments" listLabel="Assessments" />;
}
