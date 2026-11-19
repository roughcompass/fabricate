import { NotFoundPage } from "@/components/shell/system-page";

// A docs address that names no page, in the site's frame.
export default function DocsNotFound() {
  return <NotFoundPage noun="Page" listHref="/docs" listLabel="the docs" />;
}
