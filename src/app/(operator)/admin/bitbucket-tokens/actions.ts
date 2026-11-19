"use server";

import { redirect } from "next/navigation";
import { addBitbucketToken, deleteBitbucketToken } from "@/lib/admin/bitbucket-tokens";
import { getDb } from "@/lib/db/client";
import { requirePublicId } from "@/lib/db/ids";
import { submitForm } from "@/lib/web/actions";
import { text } from "@/lib/web/form-data";
import { withQuery } from "@/lib/web/query";
import type { TokenFormState } from "./form-state";
import { BITBUCKET_TOKENS_HREF } from "./paths";

/** Saves a token. A refused submission keeps the name and server, never the token, which has to be pasted again. */
export async function addToken(_previous: TokenFormState, formData: FormData): Promise<TokenFormState> {
  const form = { name: text(formData, "name", 500), serverUrl: text(formData, "serverUrl", 2_048), token: text(formData, "token", 8_192) };
  return submitForm({ name: form.name, serverUrl: form.serverUrl }, () => withQuery(BITBUCKET_TOKENS_HREF, { notice: "added", token: addBitbucketToken(getDb(), form).publicId }));
}

export async function deleteToken(formData: FormData): Promise<void> {
  const publicId = requirePublicId(text(formData, "publicId", 100), "bbt", "Bitbucket token");
  const deleted = deleteBitbucketToken(getDb(), publicId);
  redirect(`${BITBUCKET_TOKENS_HREF}?notice=deleted&name=${encodeURIComponent(deleted.name)}`);
}
