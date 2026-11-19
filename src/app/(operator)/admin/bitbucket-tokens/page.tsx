import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast } from "@/components/ui/outcome-toast";
import { param } from "@/lib/web/query";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/relative-time";
import { Primary, RowActions, Secondary, Table, Td, Th } from "@/components/ui/table";
import { listBitbucketTokens } from "@/lib/admin/bitbucket-tokens";
import { getDb } from "@/lib/db/client";
import { PRODUCT } from "@/lib/product";
import { deleteToken } from "./actions";
import { TOKEN_OUTCOME_PARAMS, tokenOutcome } from "./outcomes";
import { NEW_BITBUCKET_TOKEN_HREF } from "./paths";

export const metadata: Metadata = { title: "Bitbucket tokens" };

/** Admin: the Bitbucket Server access tokens the Frontend Registry may use, each shown by its owner, server, and last four characters. */
export default async function BitbucketTokensPage({ searchParams }: PageProps<"/admin/bitbucket-tokens">) {
  const query = await searchParams;
  const db = getDb();
  const tokens = listBitbucketTokens(db);
  const add = (
    <ButtonLink href={NEW_BITBUCKET_TOKEN_HREF} variant="primary" icon="plus">
      Add token
    </ButtonLink>
  );

  return (
    <Page>
      <PageHeader
        title="Bitbucket tokens"
        description="Access tokens for Bitbucket Server, saved on this server. A token is never shown again after it's saved, only its last four characters."
        primaryAction={add}
        alerts={<OutcomeToast outcome={tokenOutcome(db, param(query, "notice"), param(query, "token"), param(query, "name"))} strip={TOKEN_OUTCOME_PARAMS} />}
      />
      <Panel flush>
        {tokens.length > 0 ? (
          <Table
            label="Bitbucket tokens"
            head={
              <>
                <Th>Owner</Th>
                <Th>Server</Th>
                <Th>Token</Th>
                <Th>Added</Th>
                <Th align="actions" hidden>
                  Actions
                </Th>
              </>
            }
          >
            {tokens.map((token) => (
              <tr key={token.publicId}>
                <Td label="Owner">
                  <Primary>{token.name}</Primary>
                </Td>
                <Td label="Server">
                  <Secondary mono>{token.serverUrl}</Secondary>
                </Td>
                <Td label="Token">
                  <span aria-label={`Ends in ${token.tokenHint}`}>
                    <Secondary mono>{`••••${token.tokenHint}`}</Secondary>
                  </span>
                </Td>
                <Td label="Added">
                  <RelativeTime value={token.createdAt} />
                </Td>
                <Td align="actions">
                  <RowActions>
                    <ConfirmDialog
                      action={deleteToken}
                      fields={{ publicId: token.publicId }}
                      trigger={{ label: "Delete", icon: "trash" }}
                      menu={{ label: `Actions for ${token.name}`, size: "sm", variant: "tertiary" }}
                      title={`Delete ${token.name}?`}
                      confirmLabel="Delete token"
                      tone="danger"
                    >
                      <p>{`The ${PRODUCT.name} stops using it at once. Deleting it here doesn't revoke it in Bitbucket.`}</p>
                    </ConfirmDialog>
                  </RowActions>
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No Bitbucket tokens yet" icon="lock" action={add}>
            {`Add an access token for each Bitbucket Server whose repositories the ${PRODUCT.name} should read.`}
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
