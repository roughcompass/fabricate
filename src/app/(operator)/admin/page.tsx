import { redirect } from "next/navigation";
import { BITBUCKET_TOKENS_HREF } from "./bitbucket-tokens/paths";

/** Admin has one page so far. */
export default function AdminPage() {
  redirect(BITBUCKET_TOKENS_HREF);
}
