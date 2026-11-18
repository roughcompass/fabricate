"use server";

import { redirect } from "next/navigation";
import { addBitbucketToken, deleteBitbucketToken } from "@/lib/admin/bitbucket-tokens";
import { getDb } from "@/lib/db/client";
import { NotFoundError, ValidationError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { errorsFrom, text } from "@/lib/web/form-data";
import type { TokenFormState } from "./form-state";
import { BITBUCKET_TOKENS_HREF } from "./paths";

/** Saves a token. A refused submission keeps the name and server, never the token, which has to be pasted again. */
export async function addToken(_previous: TokenFormState, formData: FormData): Promise<TokenFormState> {
  const form = { name: text(formData, "name", 500), serverUrl: text(formData, "serverUrl", 2_048), token: text(formData, "token", 8_192) };
  let publicId: string;
  try {
    publicId = addBitbucketToken(getDb(), form).publicId;
  } catch (error) {
    if (error instanceof ValidationError) return { values: { name: form.name, serverUrl: form.serverUrl }, errors: errorsFrom(error) };
    throw error;
  }
  redirect(`${BITBUCKET_TOKENS_HREF}?notice=added&token=${publicId}`);
}

export async function deleteToken(formData: FormData): Promise<void> {
  const publicId = text(formData, "publicId", 100);
  if (!isPublicId(publicId, "bbt")) throw new NotFoundError("Unknown Bitbucket token");
  const deleted = deleteBitbucketToken(getDb(), publicId);
  redirect(`${BITBUCKET_TOKENS_HREF}?notice=deleted&name=${encodeURIComponent(deleted.name)}`);
}
