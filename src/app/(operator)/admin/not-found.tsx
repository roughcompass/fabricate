import { NotFoundPage } from "@/components/shell/system-page";
import { BITBUCKET_TOKENS_HREF } from "./bitbucket-tokens/paths";

export default function NotFound() {
  return <NotFoundPage noun="Bitbucket token" listHref={BITBUCKET_TOKENS_HREF} listLabel="Bitbucket tokens" />;
}
