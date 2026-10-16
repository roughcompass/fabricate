import type { Metadata } from "next";
import Link from "next/link";
import { AiNotice } from "@/components/prototypes/ai-notice";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OutcomeToast, param } from "@/components/ui/outcome-toast";
import { Page, PageHeader } from "@/components/ui/page";
import { Panel } from "@/components/ui/panel";
import { Primary, Secondary, Table, Td, Th } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { listPersonas } from "@/lib/prototypes/personas";
import { prototypesRequest } from "@/lib/prototypes/request";
import { personaOutcome } from "./outcomes";

export const metadata: Metadata = { title: "Personas" };

/** The persona library (prototypes/personas spec): the people prototypes are designed for. */
export default async function PersonasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const { db, workspace } = await prototypesRequest();
  const personas = await listPersonas(db, workspace.id);
  const create = (
    <ButtonLink href="/prototypes/personas/new" variant="primary" icon="plus">
      New persona
    </ButtonLink>
  );
  const noticed = personas.find((persona) => persona.id === param(query, "persona"));

  return (
    <Page>
      <PageHeader
        title="Personas"
        description="The people prototypes are designed for. Generations, reviews, and lessons use their goals, context, and constraints."
        primaryAction={create}
        alerts={<OutcomeToast outcome={personaOutcome(param(query, "notice"), noticed)} strip={["notice", "persona"]} />}
      />
      <AiNotice />
      <Panel flush>
        {personas.length ? (
          <Table
            label="Personas"
            head={
              <>
                <Th>Persona</Th>
                <Th>Organization</Th>
                <Th>Goals</Th>
              </>
            }
          >
            {personas.map((persona) => (
              <tr key={persona.id}>
                <Td label="Persona">
                  <Primary>
                    <Link href={`/prototypes/personas/${persona.id}`}>{persona.name}</Link> {persona.example && <Tag sans>Example</Tag>}
                  </Primary>
                  <Secondary>{persona.role}</Secondary>
                </Td>
                <Td label="Organization">{persona.organizationType || <Secondary>Not set</Secondary>}</Td>
                <Td label="Goals">
                  {persona.goals[0]}
                  {persona.goals.length > 1 && <Secondary>{`and ${persona.goals.length - 1} more`}</Secondary>}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No personas" icon="user" action={create}>
            A persona names who a prototype is for, with their goals and constraints.
          </EmptyState>
        )}
      </Panel>
    </Page>
  );
}
