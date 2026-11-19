import type { Metadata } from "next";
import { FormTemplate } from "@/components/templates/form-template";
import { PRODUCT } from "@/lib/product";
import { addToken } from "../actions";
import { BITBUCKET_TOKENS_HREF } from "../paths";
import { TokenForm } from "../token-form";

export const metadata: Metadata = { title: "Add Bitbucket token" };

export default function NewTokenPage() {
  return (
    <FormTemplate
      header={{
        breadcrumbs: [{ href: BITBUCKET_TOKENS_HREF, label: "Bitbucket tokens" }],
        title: "Add Bitbucket token",
        description: `Save an access token for a Bitbucket Server, so the ${PRODUCT.name} can read the repositories it gives access to.`,
      }}
    >
      <TokenForm action={addToken} />
    </FormTemplate>
  );
}
