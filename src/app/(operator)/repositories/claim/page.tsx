import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui/page";
import { startClaim } from "./actions";
import { UrlForm } from "./claim-forms";

export const metadata: Metadata = { title: "Claim a Repository" };

/** Step one of a claim: the git URL, matched to the catalog or added to it. */
export default function ClaimPage() {
  return (
    <Page width="form">
      <PageHeader
        breadcrumbs={[{ href: "/repositories", label: "Repositories" }]}
        title="Claim a Repository"
        description="Link a Repository to its SEAL application, team, Line of Business, and portals. You're asked only for what isn't known yet."
      />
      <UrlForm action={startClaim} />
    </Page>
  );
}
