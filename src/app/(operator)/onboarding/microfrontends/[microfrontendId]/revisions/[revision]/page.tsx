import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Attributed } from "@/components/onboarding/attribution";
import { DifferencesTable } from "@/components/onboarding/differences";
import { ValidationIssues } from "@/components/onboarding/issues";
import { RuntimeContractSummary } from "@/components/onboarding/runtime-contract";
import { DescriptionList } from "@/components/ui/description-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Page, PageHeader } from "@/components/ui/page";
import { RelativeTime } from "@/components/ui/relative-time";
import { Section } from "@/components/ui/section";
import { Status } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import { microfrontendRevisions, repositorySources } from "@/lib/db/schema";
import { compareDocuments } from "@/lib/onboarding/contracts";
import { runtimeContractSchema } from "@/lib/onboarding/documents";
import { renderingOfRevision } from "@/lib/onboarding/formats";
import { describeRendering } from "@/lib/onboarding/microfrontends";
import { latestValidation, revisionByNumber } from "@/lib/onboarding/revisions";
import { loadMicrofrontend, mfeCrumbs, mfeHref } from "../../../load";

type Params = Promise<{ microfrontendId: string; revision: string }>;

function load(microfrontendId: string, revision: string) {
  const loaded = loadMicrofrontend(microfrontendId);
  const number = /^\d{1,6}$/.test(revision) ? Number(revision) : NaN;
  const found = loaded && Number.isInteger(number) ? revisionByNumber(loaded.db, "microfrontend", loaded.microfrontend.id, number) : undefined;
  return loaded && found?.state === "submitted" ? { ...loaded, revision: found } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { microfrontendId, revision } = await params;
  const loaded = load(microfrontendId, revision);
  return { title: loaded ? `Revision ${loaded.revision.number} · ${loaded.microfrontend.name} · MFEs` : "Revision not found" };
}

/** One submitted, frozen MFE revision: its source, CDaaS view, and rendering metadata, or for the earlier format its contract, and what changed from the revision before. */
export default async function MicrofrontendRevisionPage({ params }: { params: Params }) {
  const { microfrontendId, revision: number } = await params;
  const loaded = load(microfrontendId, number);
  if (!loaded) notFound();
  const { db, microfrontend: mfe, revision } = loaded;
  const row = db.select().from(microfrontendRevisions).where(eq(microfrontendRevisions.id, revision.id)).get()!;
  const repository = row.repositorySourceId ? db.select().from(repositorySources).where(eq(repositorySources.id, row.repositorySourceId)).get() : undefined;
  const parsed = row.contract ? runtimeContractSchema.safeParse(JSON.parse(row.contract)) : null;
  const rendering = renderingOfRevision(row);
  const previous = revision.number > 1 ? revisionByNumber(db, "microfrontend", mfe.id, revision.number - 1) : undefined;
  const before = previous?.state === "submitted" ? previous : undefined;
  const validation = latestValidation(db, "microfrontend", revision.id);
  const current = revision.id === mfe.activeRevisionId;

  return (
    <Page>
      <PageHeader
        breadcrumbs={[...mfeCrumbs, { href: mfeHref(mfe.publicId), label: mfe.name }]}
        title={`Revision ${revision.number}`}
        status={<Status state={current ? "active" : "submitted"} label={current ? "Current" : "Submitted"} />}
        meta={[<span key="by">{`Submitted by ${revision.submittedBy}, unverified`}</span>, <RelativeTime key="at" value={revision.submittedAt} />]}
        description={current ? "A submitted revision is frozen. Applications binding the MFE are checked against this one." : "A submitted revision is frozen. A later revision has replaced it."}
      />
      <DescriptionList
        layout="columns"
        surface
        items={[
          ["Name", row.name ?? mfe.name],
          ["Owning team", row.ownerTeam ?? "None"],
          ["SEAL ID", row.sealId ?? "None"],
          ["Built from", repository ? `${repository.name}${row.workspacePath ? ` · ${row.workspacePath}` : " · Repository root"}` : "None"],
          ["CDaaS view", row.cdaasAppId ? <Tag key="view" label="CDaaS view">{`${row.cdaasAppId}/${row.cdaasViewId}`}</Tag> : "Not named"],
          ["Renders through", rendering ? describeRendering(rendering) : "Nothing"],
        ]}
      />
      {parsed?.success && (
        <Section title="Contract" description="Written in the earlier format: what hosts and children of this MFE were checked against while this revision was current. It's kept as history; its exports give the rendering above.">
          <RuntimeContractSummary contract={parsed.data} />
        </Section>
      )}
      <Section title={before ? `Changes from revision ${before.number}` : "Changes"} description={before ? "Each field added, removed, or changed since the revision before, contract included." : "The first revision; there's nothing to compare it with."}>
        <DifferencesTable label={`Changes from revision ${before?.number ?? revision.number}`} differences={before ? compareDocuments(before.document, revision.document) : []} empty={before ? "This revision is the same as the one before." : "This is the MFE's first revision."} />
      </Section>
      {validation && validation.issues.length > 0 && (
        <Section title="Validation at submission" description="Warnings recorded when the revision was submitted; nothing blocked it.">
          <ValidationIssues issues={validation.issues} stepOf={() => ({ href: mfeHref(mfe.publicId), label: mfe.name })} />
        </Section>
      )}
      <Disclosure summary="Details" variant="plain">
        <DescriptionList
          surface
          items={[
            ["Digest", <Tag key="digest" copy label="digest">{revision.digest!}</Tag>],
            ["Contract digest", row.contractDigest ? <Tag key="contract" copy label="contract digest">{row.contractDigest}</Tag> : "None"],
            ["Submitted by", <Attributed key="by" name={revision.submittedBy!} attribution="unverified" />],
          ]}
        />
      </Disclosure>
    </Page>
  );
}
