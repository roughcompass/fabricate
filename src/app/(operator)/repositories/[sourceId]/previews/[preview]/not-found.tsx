import { NotFoundPage } from "@/components/shell/system-page";

// A preview that doesn't exist, was deleted, or can't be shown: previews are off or its remote isn't enrolled.
export default function NotFound() {
  return <NotFoundPage noun="Preview" listHref="/repositories" listLabel="Repositories" />;
}
