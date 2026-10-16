import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShellHeader } from "@/components/shell/shell-header";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { DescriptionList } from "@/components/ui/description-list";
import { param } from "@/components/ui/outcome-toast";
import { Page } from "@/components/ui/page";
import { BRANDS } from "@/lib/demo/catalog";
import { NotFoundError } from "@/lib/db/errors";
import { isPublicId } from "@/lib/db/ids";
import { renderSrc } from "@/lib/prototypes/preview-state";
import { type KeptVersion, getPrototype, versionsOf } from "@/lib/prototypes/prototypes";
import { prototypesRequest } from "@/lib/prototypes/request";
import { checkSummary, formatFit } from "@/lib/prototypes/summary";
import { ANONYMOUS, DESCRIPTION_LENGTH, DISPLAY_NAME_LENGTH, PREVIEW_SIZE, TAG_LENGTH, TAG_LIMIT, TITLE_LENGTH, eligibility, liveTemplateFor } from "@/lib/prototypes/templates";
import { BRAND_IDS } from "@/lib/prototypes/types";
import { acceptAction, recheckAction } from "./actions";
import { templatesAvailable } from "@/lib/prototypes/guard";
import { AcceptFlow } from "./accept-flow";
import styles from "./accept.module.css";

type Query = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ prototypeId: string }> }): Promise<Metadata> {
  const { prototypeId } = await params;
  if (!isPublicId(prototypeId, "pro")) return { title: "Prototype not found" };
  const { db, workspace } = await prototypesRequest();
  const prototype = await getPrototype(db, workspace.id, prototypeId).catch(() => null);
  return { title: prototype ? `Accept as a template · ${prototype.name}` : "Prototype not found" };
}

/** What the confirmation summarizes: the checks, the audit, the fit, the personas, and the Salt release. */
function Evidence({ version }: { version: KeptVersion }) {
  const summary = checkSummary(version);
  const violations = version.audit?.violations ?? [];
  return (
    <DescriptionList
      items={[
        ["Checks", summary.text],
        ["Repairs", String(Math.max(0, version.attempts.length - 1))],
        ["Accessibility", violations.length ? violations.map((violation) => `${violation.help} (${violation.impact})`).join("; ") : "No violations"],
        ["Persona fit", version.fit?.status === "reviewed" ? version.fit.personas.map((persona) => persona.personaName).join(", ") + (version.fit.average !== null ? `: average ${formatFit(version.fit.average)}` : "") : "Not reviewed"],
        ["Personas", version.provenance?.personas.length ? version.provenance.personas.map((persona) => `${persona.name}, ${persona.role}`).join("; ") : "None"],
        ["Salt release", version.provenance?.saltRelease ?? "—"],
      ]}
    />
  );
}

/**
 * Accepting a page version as a template (versions spec): a focused page
 * whose parent is the prototype. Only an eligible page version gets the form;
 * otherwise the page names what blocks it.
 */
export default async function AcceptPage({ params, searchParams }: { params: Promise<{ prototypeId: string }>; searchParams: Promise<Query> }) {
  const [{ prototypeId }, query] = await Promise.all([params, searchParams]);
  if (!isPublicId(prototypeId, "pro")) notFound();
  if (!templatesAvailable()) notFound();
  const { db, workspace } = await prototypesRequest();
  let prototype;
  try {
    prototype = await getPrototype(db, workspace.id, prototypeId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const versions = await versionsOf(db, prototype.id);
  const requested = Number.parseInt(param(query, "v") ?? "", 10);
  const version = versions.find((entry) => entry.number === requested) ?? versions.at(-1);
  if (!version) notFound();
  const back = { href: `/prototypes/${prototype.id}${version.number === prototype.latestNumber ? "" : `?v=${version.number}`}`, label: `Back to ${prototype.name}` };
  const allowed = eligibility(version);
  const template = await liveTemplateFor(db, prototype.id);

  return (
    <Page>
      <ShellHeader title={`Accept ${prototype.name} v${version.number} as a template`} back={back} />
      <div className={styles.page}>
        <p className={styles.lead}>{`Accept version ${version.number} of ${prototype.name} as a template in Salt Patterns.`}</p>
        {allowed.eligible ? (
          <AcceptFlow
            action={acceptAction.bind(null, prototype.id, version.id, version.number)}
            initial={{
              title: template?.latest.title ?? prototype.name,
              description: template?.latest.description ?? version.provenance?.direction?.sentence ?? "",
              brand: template?.latest.brand ?? "payments",
              tags: (template?.latest.tags ?? ["Prototype"]).join(", "),
              displayName: workspace.displayName ?? "",
            }}
            brands={BRAND_IDS.map((id) => ({ value: id, label: BRANDS[id].label }))}
            limits={{ title: TITLE_LENGTH, description: DESCRIPTION_LENGTH, tags: TAG_LIMIT, tagLength: TAG_LENGTH, displayName: DISPLAY_NAME_LENGTH }}
            evidence={<Evidence version={version} />}
            captureSrc={renderSrc(`/prototypes/render/${version.id}`, { mode: "light", density: "medium" })}
            captureSize={PREVIEW_SIZE}
            updating={template ? `${template.latest.title} v${template.latestNumber + 1}` : null}
            anonymous={ANONYMOUS}
            versionId={version.id}
            recheck={recheckAction.bind(null, prototype.id, version.id)}
          />
        ) : (
          <Alert tone="warning" title="This version can't be accepted.">
            {allowed.reason}
          </Alert>
        )}
        <ButtonLink href={back.href} variant="tertiary" size="sm">
          Cancel
        </ButtonLink>
      </div>
    </Page>
  );
}
