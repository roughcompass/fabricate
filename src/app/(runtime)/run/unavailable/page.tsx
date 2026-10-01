import { notFound } from "next/navigation";

/**
 * Where a share link that no longer resolves sends the visitor: it renders
 * run/not-found.tsx, which offers a way back, with a 404 status.
 */
export default function UnavailableApplication() {
  notFound();
}
