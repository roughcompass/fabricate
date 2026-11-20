"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { countLabel } from "@/components/ui/count";
import { Checkbox, ChoiceGroup } from "@/components/ui/form";
import { useTargetDocument } from "../target-document";
import { ToolPanel } from "../tool-panel";
import { useToolbar } from "../toolbar-context";
import { useToolbarView } from "../view-context";
import { type Candidate, MECHANISM_LABELS, type Member, STATE_LABELS } from "./members";
import { useMicrofrontends } from "./microfrontends-state";
import styles from "./microfrontends.module.css";

const AS_BUILT = "as-built";
const candidateValue = (candidate: Candidate) => `${candidate.application.slug}@${candidate.preview?.key ?? ""}`;
const shortCommit = (commit: string) => commit.slice(0, 12);

/**
 * The Microfrontends tool (restore-toolbar-tools-and-branch-previews, design
 * decision 11; template-demo/microfrontends spec): the members the running
 * application composes, the selected member's detail with its Version
 * choice, then the actions. It says when routing can't apply, and why.
 */
export function MicrofrontendsPanel() {
  const state = useMicrofrontends();
  const view = useToolbarView();
  // The candidates are read again each time the panel opens, so a build that finished since is offered.
  const onOpen = useEffectEvent(() => state.refresh());
  useEffect(() => onOpen(), []);
  const { members } = state;
  const description = members.length ? `${view.name} · ${countLabel(members.length, "microfrontend")}` : view.name;
  return (
    <ToolPanel title="Microfrontends" description={description} wide>
      {state.refusal && (
        <Alert tone="warning" title="Routing is unavailable">
          {state.refusal}
        </Alert>
      )}
      {state.loading ? (
        <p className={styles.muted} role="status">
          Reading the composition…
        </p>
      ) : members.length === 0 ? (
        <Nothing />
      ) : (
        <>
          <ul className={styles.members} aria-label="Microfrontends">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </ul>
          {state.selected && <Detail key={state.selected.id} member={state.selected} />}
          <Actions />
        </>
      )}
      {state.failed && <p className={styles.muted}>The builds this application can be routed to couldn&apos;t be read. Close and open Microfrontends to try again.</p>}
    </ToolPanel>
  );
}

/** What the panel says when it lists nothing: why, naming what it looked for, or that the page is a microfrontend's own. */
function Nothing() {
  const view = useToolbarView();
  const { composition } = view;
  if (composition.containers.length) return <p className={styles.muted} data-own-page="">{`${view.name} is a Module Federation remote shown through its own page.`}</p>;
  if (composition.singleSpa.application) return <p className={styles.muted} data-own-page="">{`${view.name} is a single-spa application shown through its own page.`}</p>;
  return <p className={styles.muted} data-no-microfrontends="">{`No Module Federation remotes, single-spa applications, or import maps were found in ${view.name}'s Profile or on the page.`}</p>;
}

function MemberRow({ member }: { member: Member }) {
  const state = useMicrofrontends();
  const pending = state.pending.has(member.id);
  return (
    <li>
      <button type="button" className={styles.member} aria-pressed={state.selected?.id === member.id} onClick={() => state.select(member.id)} data-member={member.name} data-member-state={member.state}>
        <span className={styles.memberName}>
          <code>{member.name}</code>
          <span className={styles.memberMeta}>{MECHANISM_LABELS[member.mechanism]}</span>
        </span>
        <span className={styles.memberMeta}>
          {member.address && <code className={styles.address}>{member.address}</code>}
          <span className={styles.flag} data-state={member.state}>
            {STATE_LABELS[member.state]}
          </span>
          {pending && <span className={styles.flagPending}>Pending</span>}
        </span>
        {member.route && <span className={styles.memberMeta} data-routed-to="">{`Routed to ${member.route.target.application} · ${member.route.target.label} · ${shortCommit(member.route.target.commit)}`}</span>}
      </button>
    </li>
  );
}

function Detail({ member }: { member: Member }) {
  const state = useMicrofrontends();
  const [error, setError] = useState<string | null>(null);
  const routable = member.mechanism === "module-federation" || member.mechanism === "import-map";
  const pending = state.pending.get(member.id);
  const chosen = state.pending.has(member.id) ? pending : member.route ? (member.candidates.find((candidate) => candidate.build?.preview === member.route!.target.build) ?? null) : null;
  const selected = chosen ? candidateValue(chosen) : AS_BUILT;
  const foreign = state.refusal?.includes("own service worker") ?? false;
  return (
    <section className={styles.detail} aria-labelledby="member-detail-title" data-member-detail={member.name}>
      <h3 id="member-detail-title" className={styles.sectionTitle}>
        <code>{member.name}</code>
      </h3>
      <p className={styles.muted}>{member.entry ? `${MECHANISM_LABELS[member.mechanism]} · as built at ${member.entry}` : `${MECHANISM_LABELS[member.mechanism]} · Loaded by code`}</p>
      {routable && !member.entry && <p className={styles.muted}>{`${member.name} has no address the page requests, so it can't be routed.`}</p>}
      {routable && member.entry && !foreign && (
        <>
          <ChoiceGroup
            key={`${member.id}:${selected}`}
            id={`version-${member.id.replace(/[^\w-]/g, "_")}`}
            name={`version-${member.id}`}
            legend="Version"
            type="radio"
            selected={[selected]}
            errors={error ? [error] : undefined}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const candidate = value === AS_BUILT ? null : (member.candidates.find((option) => candidateValue(option) === value) ?? null);
              setError(state.choose(member, candidate));
            }}
            choices={[
              { value: AS_BUILT, label: "As built", description: member.entry, disabled: Boolean(state.refusal) },
              ...member.candidates.map((candidate) => ({
                value: candidateValue(candidate),
                label: `${candidate.application.name} · ${candidate.label}`,
                description: candidate.build ? shortCommit(candidate.build.commit) : "Unavailable while it builds",
                disabled: !candidate.build || Boolean(state.refusal),
              })),
            ]}
          />
          {member.candidates.length === 0 && <p className={styles.muted} data-no-builders="">{`No application builds ${member.name}. Creating an application from the remote's repository makes its builds available.`}</p>}
          <p className={styles.muted}>Routing applies to this view in this browser until you reset it, and offers only builds the Frontend Registry has.</p>
        </>
      )}
      {member.mechanism === "found" && <p className={styles.muted}>{`${member.name} was found only on the page, so no build the Frontend Registry has can be matched to it.`}</p>}
      {member.mechanism === "module-federation" && <p className={styles.muted} data-no-region="">{`Module Federation modules have no region of their own on the page, so ${member.name} can't be outlined or selected on it.`}</p>}
    </section>
  );
}

function Actions() {
  const state = useMicrofrontends();
  const { closeTool, setMode } = useToolbar();
  const target = useTargetDocument();
  const changes = state.pending.size;
  const regions = state.members.some((member) => member.region);
  return (
    <>
      <div className={styles.actions}>
        <Button variant="primary" icon="refresh" onClick={state.reload} disabled={changes === 0}>
          {changes > 1 ? `Reload application (${changes} changes)` : "Reload application"}
        </Button>
        <Button onClick={state.reset} disabled={state.routes.length === 0 && changes === 0}>
          Reset routing
        </Button>
        {regions && (
          <Button
            variant="tertiary"
            icon="target"
            disabled={!target.document}
            onClick={() => {
              closeTool();
              setMode("select");
            }}
          >
            Select on page
          </Button>
        )}
      </div>
      {regions && <Checkbox id="microfrontends-regions" label="Show regions" description="Outline each single-spa application mounted on the page, with its name and whether it's routed." checked={state.showRegions} onChange={(event) => state.setShowRegions(event.currentTarget.checked)} />}
    </>
  );
}
