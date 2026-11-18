import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui/page";
import { addToken } from "../actions";
import { BITBUCKET_TOKENS_HREF } from "../paths";
import { TokenForm } from "../token-form";

export const metadata: Metadata = { title: "Add Bitbucket token" };

export default function NewTokenPage() {
  return (
    <Page width="form">
      <PageHeader breadcrumbs={[{ href: BITBUCKET_TOKENS_HREF, label: "Bitbucket tokens" }]} title="Add Bitbucket token" description="Save an access token for a Bitbucket Server, so DE FabLab can read the repositories it gives access to." />
      <TokenForm action={addToken} />
    </Page>
  );
}
