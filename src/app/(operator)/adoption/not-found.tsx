import { NotFoundPage } from "@/components/shell/system-page";

/** A design system the Reference Catalog doesn't describe, or a component it neither lists nor sees used. */
export default function AdoptionNotFound() {
  return <NotFoundPage noun="Page" listHref="/adoption" listLabel="Adoption" />;
}
