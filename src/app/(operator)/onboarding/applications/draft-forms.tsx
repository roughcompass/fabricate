"use client";

import { useState } from "react";
import { ActorField, type DraftAction, DraftForm, type DraftFormState, value, values } from "@/components/onboarding/draft-form";
import styles from "@/components/onboarding/onboarding.module.css";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, ChoiceGroup, FormNote, FormSection, Select, TextArea, TextInput } from "@/components/ui/form";
import { IFRAME_PERMISSIONS, RENDERING_MODES, RENDERING_MODE_LABELS, type RenderingMode, SANDBOX_TOKENS } from "@/lib/onboarding/vocabulary";

interface StepProps {
  action: DraftAction;
  initial: DraftFormState;
  cancelHref: string;
  /** Issues about the step as a whole, such as both launch targets at once. */
  notes?: readonly string[];
}

const errors = (state: DraftFormState, field: string) => state.errors[field];
const rows = (state: DraftFormState, list: string) => values(state, `${list}.rows`).map(Number);

function SaveAndContinue() {
  return (
    <Button type="submit" name="intent" value="continue">
      Save and continue
    </Button>
  );
}

/** Messages that belong to a row as a whole, such as its MFE's state. */
function RowFeedback({ title, messages }: { title: string; messages: readonly string[] | undefined }) {
  if (!messages?.length) return null;
  return (
    <FormNote title={title} icon="alert">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </FormNote>
  );
}

export function IdentityStep({ action, initial, cancelHref, notes, sameSeal, history }: StepProps & { sameSeal: React.ReactNode; history?: React.ReactNode }) {
  return (
    <DraftForm id="application-identity" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => (
        <>
          <FormSection title="Name and owner">
            <TextInput id="name" name="name" label="Name" defaultValue={value(state, "name")} errors={errors(state, "name")} maxLength={200} required />
            <TextInput id="ownerTeam" name="ownerTeam" label="Owning team" defaultValue={value(state, "ownerTeam")} errors={errors(state, "ownerTeam")} maxLength={200} required />
            <TextInput id="sealId" name="sealId" label="SEAL ID" mono optional defaultValue={value(state, "sealId")} errors={errors(state, "sealId")} maxLength={64} description="Metadata: other Applications may carry the same one and stay separate records." />
            {sameSeal}
          </FormSection>
          {history}
        </>
      )}
    </DraftForm>
  );
}

export interface MfeOption {
  value: string;
  label: string;
  /** How its submitted revision renders, such as "Module Federation 2 (./App)". */
  renders: string;
  /** The modules a host can mount from it as a child. */
  modules: string[];
}

export interface CandidateView {
  key: string;
  mode: RenderingMode;
  module: string | null;
  location: string | null;
  source: string;
  evidence: string;
  observed: string;
}

export interface RenderingView {
  candidates: CandidateView[];
  agreed: boolean;
  /** How the mode is settled for the saved launch values, or null while it isn't. */
  confirmation: { kind: "inferred" | "override" | "explicit"; by: string; at: string; candidate: string | null } | null;
  /** True when the evidence doesn't support the inferred proposal confirmed earlier. */
  stale: boolean;
  /** Mapped evidence that proposes nothing, and why, such as a Studio module not read yet. */
  unknown: string[];
  /** Why nothing is proposed, when nothing is. */
  silence: string | null;
}

const MODE_CHOICES = RENDERING_MODES.map((mode) => ({ value: mode, label: RENDERING_MODE_LABELS[mode] }));

/**
 * The launch target: a registered MFE or an external endpoint, the rendering
 * mode, and the values that mode needs. Below them, the proposals the
 * evidence makes, each with its source and time, and the confirmation the
 * team gives before submitting.
 */
export function LaunchStep({ action, initial, cancelHref, notes, mfes, rendering }: StepProps & { mfes: readonly MfeOption[]; rendering: RenderingView }) {
  return (
    <DraftForm id="application-launch" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => <LaunchFields state={state} mfes={mfes} rendering={rendering} />}
    </DraftForm>
  );
}

function LaunchFields({ state, mfes, rendering }: { state: DraftFormState; mfes: readonly MfeOption[]; rendering: RenderingView }) {
  const [kind, setKind] = useState(value(state, "launch.kind"));
  const [mode, setMode] = useState(value(state, "launch.mode"));
  const external = kind === "external";
  const chosenMfe = mfes.find((option) => option.value === value(state, "launch.microfrontend"));
  return (
    <>
      <FormSection title="Target">
        <ChoiceGroup
          id="launch-kind"
          name="launch.kind"
          legend="The Portal launches"
          type="radio"
          columns
          selected={[kind]}
          errors={errors(state, "launch-kind")}
          onChange={(event) => setKind(event.target.value)}
          choices={[
            { value: "mfe", label: "A registered MFE", description: "Served by CDaaS; its rendering metadata proposes how it renders." },
            { value: "external", label: "An external endpoint", description: "Hosted elsewhere; no MFE or CDaaS view is needed." },
          ]}
        />
        {kind === "mfe" &&
          (mfes.length > 0 ? (
            <Select id="launch-microfrontend" name="launch.microfrontend" label="MFE" defaultValue={value(state, "launch.microfrontend")} errors={errors(state, "launch-microfrontend")} description={chosenMfe ? `Loads through ${chosenMfe.renders}.` : "MFEs with a submitted revision."} options={[{ value: "", label: "Choose an MFE" }, ...mfes.map((option) => ({ value: option.value, label: option.label }))]} />
          ) : (
            <FormNote title="No MFEs to launch yet" icon="layers">
              Register the MFE from the composition step and submit its first revision, or launch an external endpoint instead.
            </FormNote>
          ))}
        <ChoiceGroup id="launch-mode" name="launch.mode" legend="Rendering mode" type="radio" columns selected={[mode]} errors={errors(state, "launch-mode")} onChange={(event) => setMode(event.target.value)} choices={MODE_CHOICES} description={kind ? undefined : "Choose the target first. Without JavaScript, save to show the values the mode needs."} />
      </FormSection>
      {kind && mode && (
        <FormSection title={`${RENDERING_MODE_LABELS[mode as RenderingMode]} values`}>
          {mode === "iframe" && (
            <>
              {external && <TextInput id="launch-documentUrl" name="launch.documentUrl" label="Document URL" mono defaultValue={value(state, "launch.documentUrl")} errors={errors(state, "launch-documentUrl")} description="The https page the frame loads, with no credentials or fragment." maxLength={2048} />}
              <ChoiceGroup id="launch-sandbox" name="launch.sandbox" legend="Sandbox tokens" type="checkbox" columns optional selected={values(state, "launch.sandbox")} errors={errors(state, "launch-sandbox")} choices={SANDBOX_TOKENS.map((token) => ({ value: token, label: token }))} />
              <ChoiceGroup id="launch-permissions" name="launch.permissions" legend="Permissions it needs delegated" type="checkbox" columns optional selected={values(state, "launch.permissions")} errors={errors(state, "launch-permissions")} choices={IFRAME_PERMISSIONS.map((permission) => ({ value: permission, label: permission }))} />
            </>
          )}
          {mode === "esm" && (
            <>
              {external && <TextInput id="launch-moduleUrl" name="launch.moduleUrl" label="Module URL" mono defaultValue={value(state, "launch.moduleUrl")} errors={errors(state, "launch-moduleUrl")} description="The https JavaScript module the Portal imports." maxLength={2048} />}
              <TextInput id="launch-exportedModule" name="launch.exportedModule" label="Exported module" mono defaultValue={value(state, "launch.exportedModule")} errors={errors(state, "launch-exportedModule")} description={external ? "The export the Portal mounts, such as mount." : "The export of the MFE the Portal mounts, such as ./App."} maxLength={300} />
              {external && <TextInput id="launch-integrity" name="launch.integrity" label="Integrity hash" mono optional defaultValue={value(state, "launch.integrity")} errors={errors(state, "launch-integrity")} description="Such as sha384-…, when the module publishes one." maxLength={200} />}
            </>
          )}
          {mode === "module_federation_2" && (
            <>
              {external && <TextInput id="launch-manifestUrl" name="launch.manifestUrl" label="Manifest URL" mono defaultValue={value(state, "launch.manifestUrl")} errors={errors(state, "launch-manifestUrl")} description="The https Module Federation manifest, such as …/mf-manifest.json." maxLength={2048} />}
              <TextInput id="launch-exposedModule" name="launch.exposedModule" label="Exposed module" mono defaultValue={value(state, "launch.exposedModule")} errors={errors(state, "launch-exposedModule")} description="Such as ./App." maxLength={300} />
            </>
          )}
        </FormSection>
      )}
      <RenderingConfirmation state={state} rendering={rendering} />
    </>
  );
}

const CONFIRMED = { inferred: "Confirmed from the evidence", override: "Overridden: the values above were chosen over the evidence", explicit: "Chosen explicitly: no evidence proposed a mode" } as const;

function RenderingConfirmation({ state, rendering }: { state: DraftFormState; rendering: RenderingView }) {
  const { candidates, confirmation } = rendering;
  return (
    <div id="rendering" className={styles.rows}>
      <FormSection title="Rendering mode confirmation" description="A proposal is only a proposal: the team confirms one, or the values entered above, before submitting. Changing the launch values clears the confirmation.">
        {confirmation ? (
          <FormNote title={CONFIRMED[confirmation.kind]} icon="checkCircle">
            {`By ${confirmation.by}, unverified, ${confirmation.at}.`}
          </FormNote>
        ) : rendering.stale ? (
          <FormNote title="Confirm again" icon="alert">
            The evidence behind the confirmed proposal has changed.
          </FormNote>
        ) : null}
        {candidates.length > 0 ? (
          <>
            <p>{rendering.agreed ? "The evidence proposes one mode:" : "The evidence proposes different modes. Choose one, or override them with the values above:"}</p>
            <ul className={styles.rows}>
              {candidates.map((candidate) => (
                <li key={candidate.key} className={styles.candidate}>
                  <div>
                    <strong>{`${RENDERING_MODE_LABELS[candidate.mode]}${candidate.module ? ` · ${candidate.module}` : ""}`}</strong>
                    <p>{`${candidate.source}: ${candidate.evidence}${candidate.location ? ` at ${candidate.location}` : ""}. Observed ${candidate.observed}.`}</p>
                  </div>
                  <Button type="submit" name="intent" value={`confirm:${candidate.key}`} size="sm" variant={confirmation?.candidate === candidate.key ? "secondary" : undefined}>
                    {confirmation?.candidate === candidate.key ? "Confirmed" : `Confirm ${RENDERING_MODE_LABELS[candidate.mode]}`}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{rendering.silence ?? "Nothing proposes a mode, so choose one above and confirm it."}</p>
        )}
        {rendering.unknown.map((message) => (
          <p key={message}>{`${message}. Unknown evidence proposes nothing.`}</p>
        ))}
        <ActorField state={state} id="actor" />
        <div className={styles.rowActions}>
          <Button type="submit" name="intent" value="confirm">
            {candidates.length > 0 ? "Override with the values above" : "Confirm the values above"}
          </Button>
        </div>
      </FormSection>
    </div>
  );
}

/** A shared MFE the picker found. */
export interface PickerResult {
  value: string;
  label: string;
  team: string | null;
  renders: string;
  uses: number;
  /** Why it can't be added: already bound, or the launch target. */
  unavailable: string | null;
  openHref: string;
  /** Where its team edits it, for an MFE the Application's team owns; null otherwise. */
  editHref: string | null;
  /** Who changes it, when the Application's team can't. */
  owner: string | null;
}

/**
 * The children the launch target composes, each a shared MFE with its mount
 * and the module its host mounts. Above them, the shared-MFE picker: reuse
 * an existing MFE, or register a missing one without leaving the Draft.
 */
export function CompositionStep({ action, initial, cancelHref, notes, mfes, entry, external, picker }: StepProps & { mfes: readonly MfeOption[]; entry: string | null; external: boolean; picker: { search: string; results: readonly PickerResult[]; registerHref: string } }) {
  return (
    <DraftForm id="application-composition" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => {
        const indices = rows(state, "children");
        return (
          <>
            <FormSection title="Host" description="The launch target loads and renders every child at runtime; onboarding only records and checks the composition.">
              <p>{entry ? `${entry} is the entry: the registered MFE the Portal launches. It hosts the children below.` : external ? "The external endpoint hosts the children below. No MFE is the entry." : "Choose the launch target first; it hosts the children."}</p>
            </FormSection>
            <FormSection title="Shared MFEs" description="Reuse an MFE another Application already uses, or register a missing one. Choosing one binds that MFE; nothing is copied.">
              {picker.results.length > 0 ? (
                <ul className={styles.rows} aria-label="Shared MFEs">
                  {picker.results.map((result) => (
                    <li key={result.value} className={styles.candidate}>
                      <div>
                        <strong>{result.label}</strong>
                        <p>{[result.team ? `Owned by ${result.team}` : "No owning team yet", `loads through ${result.renders}`, result.uses === 1 ? "used by 1 Application" : `used by ${result.uses} Applications`].join(" · ")}</p>
                        {result.owner && <p>{result.owner}</p>}
                      </div>
                      <div className={styles.rowActions}>
                        <ButtonLink href={result.openHref} size="sm" variant="tertiary">
                          {`Open ${result.label}`}
                        </ButtonLink>
                        {result.editHref && (
                          <ButtonLink href={result.editHref} size="sm" variant="tertiary" icon="edit">
                            {`Edit ${result.label}`}
                          </ButtonLink>
                        )}
                        {result.unavailable ? (
                          <span>{result.unavailable}</span>
                        ) : (
                          <Button type="submit" name="intent" value={`pick:${result.value}`} size="sm" icon="plus">
                            {`Add ${result.label} as a child`}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{picker.search ? `No MFE matches “${picker.search}”. Register it if it's missing.` : "No MFEs are registered yet."}</p>
              )}
              <div className={styles.rowActions}>
                <ButtonLink href={picker.registerHref} icon="plus">
                  Register MFE
                </ButtonLink>
              </div>
            </FormSection>
            {indices.length === 0 && <p>No children yet. A single-MFE Application needs none.</p>}
            {indices.map((index, position) => (
              <ChildRow key={index} state={state} index={index} position={position} last={position === indices.length - 1} mfes={mfes} />
            ))}
            <div className={styles.rowActions}>
              <Button type="submit" name="intent" value="add:children" icon="plus">
                Add child
              </Button>
            </div>
          </>
        );
      }}
    </DraftForm>
  );
}

function ChildRow({ state, index, position, last, mfes }: { state: DraftFormState; index: number; position: number; last: boolean; mfes: readonly MfeOption[] }) {
  const at = `children.${index}`;
  const id = `children-${position}`;
  const [chosen, setChosen] = useState(value(state, `${at}.microfrontend`));
  const mfe = mfes.find((option) => option.value === chosen);
  return (
    <FormSection title={mfe ? `Child ${mfe.label}` : `Child ${position + 1}`} description={mfe ? `Loads through ${mfe.renders}.` : undefined}>
      <input type="hidden" name="children.rows" value={index} />
      <div id={last ? "last-row" : undefined} className={styles.row}>
        <Select id={`${id}-microfrontend`} name={`${at}.microfrontend`} label="MFE" defaultValue={chosen} errors={errors(state, `${id}-microfrontend`)} onChange={(event) => setChosen(event.target.value)} options={[{ value: "", label: "Choose an MFE" }, ...mfes.map((option) => ({ value: option.value, label: option.label }))]} />
        <Select
          key={chosen}
          id={`${id}-module`}
          name={`${at}.module`}
          label="Module the host mounts"
          defaultValue={value(state, `${at}.module`)}
          errors={errors(state, `${id}-module`)}
          description={!mfe ? "Choose the MFE first. Without JavaScript, save to list its modules." : mfe.modules.length === 0 ? "It can only be framed, so it names no module." : mfe.modules.length === 1 ? "Its one module is used unless you choose." : undefined}
          options={[{ value: "", label: mfe && mfe.modules.length === 1 ? `${mfe.modules[0]} (its only module)` : "Choose a module" }, ...(mfe?.modules ?? []).map((module) => ({ value: module, label: module }))]}
        />
        <Select id={`${id}-mountKind`} name={`${at}.mountKind`} label="Mounts at" defaultValue={value(state, `${at}.mountKind`)} errors={errors(state, `${id}-mountKind`)} options={[{ value: "", label: "Choose route or slot" }, { value: "route", label: "A route" }, { value: "slot", label: "A slot" }]} />
        <TextInput id={`${id}-mountKey`} name={`${at}.mountKey`} label="Route or slot" mono defaultValue={value(state, `${at}.mountKey`)} errors={errors(state, `${id}-mountKey`)} description="Such as /payees/search or sidebar." maxLength={300} />
      </div>
      <Checkbox id={`${id}-required`} name={`${at}.required`} label="Required" defaultChecked={value(state, `${at}.required`) === "on"} description="The Application can't work without it." />
      <RowFeedback title="This child" messages={errors(state, `${id}-feedback`)} />
      <div className={styles.rowActions}>
        <Button type="submit" name="intent" value={`remove:children:${position}`} variant="tertiary" size="sm" icon="trash">
          {`Remove ${mfe?.label ?? `child ${position + 1}`}`}
        </Button>
      </div>
    </FormSection>
  );
}

export interface PortalOption {
  value: string;
  label: string;
  /** Its governing revision's menu groups, and the environments it enables, with their catalog labels. */
  menu: { key: string; label: string }[];
  environments: { key: string; label: string }[];
}

/**
 * Placement requests, any number per Portal: each asks for a route, a menu
 * position, environments, and entitlements. The Portal's owner decides
 * each one; nothing here activates a route.
 */
export interface CandidateOption {
  portal: string;
  label: string;
  onboarded: boolean;
  /** Who claimed it, and when, as text. */
  claim: string;
}

export function PlacementsStep({ action, initial, cancelHref, notes, portals, states, candidates }: StepProps & { portals: readonly PortalOption[]; states: Record<string, string>; candidates: readonly CandidateOption[] }) {
  return (
    <DraftForm id="application-placements" action={action} initial={initial} cancelHref={cancelHref} notes={notes} extraButtons={<SaveAndContinue />}>
      {(state) => {
        const indices = rows(state, "placements");
        const requested = new Set(indices.map((index) => value(state, `placements.${index}.portal`)));
        const open = candidates.filter((candidate) => !requested.has(candidate.portal));
        return (
          <>
            {open.length > 0 && (
              <FormNote title="Claimed in ownership, not requested yet">
                <p>Ownership claims put the Application in these Portals. A claim is only a candidate: request a placement, and the Portal reviews it.</p>
                <ul className={styles.rows}>
                  {open.map((candidate) => (
                    <li key={candidate.portal} className={styles.candidate}>
                      <div>
                        <strong>{candidate.label}</strong>
                        <p>{candidate.onboarded ? candidate.claim : `${candidate.claim}. ${candidate.label} isn't onboarded yet, so it can't take placements.`}</p>
                      </div>
                      {candidate.onboarded && (
                        <Button type="submit" name="intent" value={`candidate:${candidate.portal}`} size="sm" icon="plus">
                          {`Request a placement in ${candidate.label}`}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </FormNote>
            )}
            {indices.length === 0 && <p>No placements yet. Ask each Portal that should serve the Application for a route.</p>}
            {indices.map((index, position) => (
              <PlacementRow key={index} state={state} index={index} position={position} last={position === indices.length - 1} portals={portals} existing={states[value(state, `placements.${index}.placement`)]} />
            ))}
            <div className={styles.rowActions}>
              <Button type="submit" name="intent" value="add:placements" icon="plus">
                Add placement
              </Button>
            </div>
          </>
        );
      }}
    </DraftForm>
  );
}

function PlacementRow({ state, index, position, last, portals, existing }: { state: DraftFormState; index: number; position: number; last: boolean; portals: readonly PortalOption[]; existing: string | undefined }) {
  const at = `placements.${index}`;
  const id = `placements-${position}`;
  const [portalId, setPortalId] = useState(value(state, `${at}.portal`));
  const portal = portals.find((option) => option.value === portalId);
  const placement = value(state, `${at}.placement`);
  return (
    <FormSection title={`${portal ? `In ${portal.label}` : `Placement ${position + 1}`}${value(state, `${at}.route`) ? ` at ${value(state, `${at}.route`)}` : ""}`} description={existing ? `Revises an existing placement, ${existing}. Its Portal reviews this request on its own.` : undefined}>
      <input type="hidden" name="placements.rows" value={index} />
      <input type="hidden" name={`${at}.placement`} value={placement} />
      <div id={last ? "last-row" : undefined} className={styles.row}>
        {placement ? (
          <>
            <input type="hidden" name={`${at}.portal`} value={portalId} />
            <TextInput id={`${id}-portal`} label="Portal" value={portal?.label ?? portalId} readOnly description="A placement stays in its Portal. Remove it and add another to move it." />
          </>
        ) : (
          <Select id={`${id}-portal`} name={`${at}.portal`} label="Portal" defaultValue={portalId} errors={errors(state, `${id}-portal`)} onChange={(event) => setPortalId(event.target.value)} options={[{ value: "", label: "Choose a Portal" }, ...portals.map((option) => ({ value: option.value, label: option.label }))]} />
        )}
        <Select key={portalId} id={`${id}-menuParent`} name={`${at}.menuParent`} label="Menu group" defaultValue={value(state, `${at}.menuParent`)} errors={errors(state, `${id}-menuParent`)} description={portal ? undefined : "Choose the Portal first. Without JavaScript, save to list its groups."} options={[{ value: "", label: "Top level" }, ...(portal?.menu ?? []).map((group) => ({ value: group.key, label: group.label }))]} />
        <TextInput id={`${id}-route`} name={`${at}.route`} label="Route" mono defaultValue={value(state, `${at}.route`)} errors={errors(state, `${id}-route`)} description="Such as /payments." maxLength={300} />
        <TextInput id={`${id}-label`} name={`${at}.label`} label="Menu label" defaultValue={value(state, `${at}.label`)} errors={errors(state, `${id}-label`)} maxLength={100} />
        <TextInput id={`${id}-order`} name={`${at}.order`} label="Position" inputMode="numeric" defaultValue={value(state, `${at}.order`)} errors={errors(state, `${id}-order`)} maxLength={6} />
      </div>
      <PlacementEnvironments key={`environments-${portalId}`} state={state} at={at} id={id} portal={portal} />
      <div className={styles.row}>
        <TextArea id={`${id}-entitlements`} name={`${at}.codes`} label="Entitlement codes" optional rows={2} defaultValue={value(state, `${at}.codes`)} errors={errors(state, `${id}-entitlements`)} description="What a visitor needs to see it here, one per line. The Portal team accepts or changes them when it reviews the placement. None means no restriction." />
        <Select id={`${id}-operator`} name={`${at}.operator`} label="A visitor needs" defaultValue={value(state, `${at}.operator`) || "any"} options={[{ value: "any", label: "Any one of them" }, { value: "all", label: "All of them" }]} />
      </div>
      <Checkbox id={`${id}-defaultRequested`} name={`${at}.defaultRequested`} label="Ask to be the Portal's default route" defaultChecked={value(state, `${at}.defaultRequested`) === "on"} description="Only a request: the Portal's owner chooses each environment's default." />
      <RowFeedback title="This placement" messages={errors(state, `${id}-feedback`)} />
      <div className={styles.rowActions}>
        <Button type="submit" name="intent" value={`remove:placements:${position}`} variant="tertiary" size="sm" icon="trash">
          {`Remove placement ${position + 1}`}
        </Button>
      </div>
    </FormSection>
  );
}

/** The environments a placement appears in, from the ones its Portal enables. A saved choice the Portal no longer enables stays listed, so it can be unchecked. */
function PlacementEnvironments({ state, at, id, portal }: { state: DraftFormState; at: string; id: string; portal: PortalOption | undefined }) {
  const selected = values(state, `${at}.environments`);
  const offered = portal?.environments ?? [];
  const unavailable = selected.filter((key) => !offered.some((environment) => environment.key === key));
  return (
    <ChoiceGroup
      id={`${id}-environments`}
      name={`${at}.environments`}
      legend="Environments"
      type="checkbox"
      columns
      selected={selected}
      errors={errors(state, `${id}-environments`)}
      description={portal ? `The environments ${portal.label} enables. The placement appears in the ones you choose.` : "Choose the Portal first. Without JavaScript, save to list its environments."}
      choices={[...offered.map((environment) => ({ value: environment.key, label: environment.label })), ...unavailable.map((key) => ({ value: key, label: key.toUpperCase(), description: portal ? `Not enabled in ${portal.label}` : undefined }))]}
    />
  );
}
