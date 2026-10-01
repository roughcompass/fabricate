"use client";

import { useEffect, useId, useState } from "react";
import { ToolPanel } from "@/components/toolbar/tool-panel";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, FormAlert, Select, TextInput } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { DEFAULT_PROFILE, PERSONAS, type Persona, type Profile } from "@/lib/demo/catalog";
import { DUPLICATE_NAME, PROFILE_FIELD_LIMIT, type ProfileFields, nameTaken, profileFieldErrors } from "@/lib/demo/profile-fields";
import { SHARED_PROFILE_ID } from "../runtime/view-store";
import { availableProfiles } from "../runtime/profiles";
import { useCustomProfiles, useProfile, useRuntime } from "../runtime/runtime-context";
import styles from "./session.module.css";

type Errors = Record<string, string[]>;
type Result = { ok: true; profile?: Profile; profiles: Profile[] } | { ok: false; errors: Errors };

/** Calls the profile routes, turning every failure into messages the panel can show. */
async function send(path: string, method: "POST" | "PATCH" | "DELETE", fields?: ProfileFields): Promise<Result> {
  try {
    const response = await fetch(path, { method, ...(fields ? { headers: { "content-type": "application/json" }, body: JSON.stringify(fields) } : {}) });
    const data = (await response.json().catch(() => ({}))) as { profile?: Profile; profiles?: Profile[]; errors?: Errors };
    if (response.ok && data.profiles) return { ok: true, ...(data.profile ? { profile: data.profile } : {}), profiles: data.profiles };
    return { ok: false, errors: data.errors ?? { base: [response.status === 404 ? "That profile no longer exists. Reload the page to see your profiles." : "The profile could not be saved. Try again."] } };
  } catch {
    return { ok: false, errors: { base: ["The profile could not be saved. Check your connection and try again."] } };
  }
}

const NEW_BUTTON = "session-new-profile";
/** Focus goes back to New profile once the form that replaced it is gone. */
const focusNewButton = () => window.requestAnimationFrame(() => document.getElementById(NEW_BUTTON)?.focus());

const detail = (profile: Profile) => `${profile.persona} · ${profile.region}${profile.id === SHARED_PROFILE_ID ? " · From share link" : profile.builtIn ? " · Built-in" : ""}`;

/**
 * The Session tool (template-demo/toolbar spec): who is using the running
 * application. Visitors choose the active profile from the share link's
 * snapshot, the built-in profiles, and their own, and create, edit, and
 * delete their own, which every application in their workspace offers. The
 * change applies to every microfrontend at once.
 */
export function SessionPanel() {
  const { store, profiles, sharedProfile } = useRuntime();
  const custom = useCustomProfiles();
  const active = useProfile();
  const { toast } = useToast();
  const [editing, setEditing] = useState<{ profile: Profile | null } | null>(null);
  // Bumped when the active profile changes other than by the radios, so they show it.
  const [revision, setRevision] = useState(0);
  const all = availableProfiles(custom, sharedProfile);

  const activate = (id: string) => {
    store.setProfile(id);
    setRevision((current) => current + 1);
  };

  const restore = async (profile: Profile, wasActive: boolean) => {
    const result = await send("/api/demo/profiles", "POST", { name: profile.name, persona: profile.persona, region: profile.region });
    if (!result.ok) {
      toast({ tone: "error", title: `${profile.name} could not be restored`, description: Object.values(result.errors).flat()[0] ?? "" });
      return;
    }
    profiles.setProfiles(result.profiles);
    if (wasActive && result.profile) store.setProfile(result.profile.id);
  };

  const remove = async (profile: Profile) => {
    const wasActive = active.id === profile.id;
    const previous = profiles.getProfiles();
    // Optimistic: the profile goes at once, and any application showing it falls back to Jordan Lee.
    profiles.setProfiles(previous.filter((entry) => entry.id !== profile.id));
    if (wasActive) activate(DEFAULT_PROFILE.id);
    const result = await send(`/api/demo/profiles/${profile.id}`, "DELETE");
    if (!result.ok) {
      profiles.setProfiles(previous);
      if (wasActive) activate(profile.id);
      toast({ tone: "error", title: `${profile.name} could not be deleted`, description: Object.values(result.errors).flat()[0] ?? "" });
      return;
    }
    profiles.setProfiles(result.profiles);
    toast({ title: `Deleted ${profile.name}`, action: { label: "Undo", onAction: () => void restore(profile, wasActive) } });
    focusNewButton();
  };

  return (
    <ToolPanel title="Session" description="Who is using this application. Their persona decides what each microfrontend shows.">
      <ChoiceGroup
        key={`profiles-${revision}-${all.map((profile) => `${profile.id}:${profile.name}:${profile.persona}:${profile.region}`).join("|")}`}
        id="session-profile"
        name="session-profile"
        legend="Signed in as"
        type="radio"
        selected={[active.id]}
        onChange={(event) => store.setProfile(event.currentTarget.value)}
        choices={all.map((profile) => ({ value: profile.id, label: profile.name, description: detail(profile) }))}
      />

      <section className={styles.section} aria-labelledby="session-yours-title">
        <div className={styles.sectionHeader}>
          <h3 id="session-yours-title" className={styles.sectionTitle}>
            Your profiles
          </h3>
          {!editing && (
            <Button id={NEW_BUTTON} size="sm" icon="plus" onClick={() => setEditing({ profile: null })}>
              New profile
            </Button>
          )}
        </div>
        {custom.length ? (
          <ul className={styles.list} aria-label="Your profiles">
            {custom.map((profile) => (
              <li key={profile.id} className={styles.row} data-profile={profile.id}>
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{profile.name}</span>
                  <span className={styles.rowMeta}>{`${profile.persona} · ${profile.region}`}</span>
                </span>
                <Button size="sm" variant="tertiary" icon="edit" label={`Edit ${profile.name}`} onClick={() => setEditing({ profile })} />
                <Button size="sm" variant="tertiary" icon="trash" label={`Delete ${profile.name}`} onClick={() => void remove(profile)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Create a profile for someone your audience will recognize. It&apos;s saved in this demo workspace and offered in every application.</p>
        )}
        {editing && (
          <ProfileForm
            key={editing.profile?.id ?? "new"}
            profile={editing.profile}
            others={custom.filter((profile) => profile.id !== editing.profile?.id)}
            onSaved={(result, saved) => {
              profiles.setProfiles(result);
              // Editing the active profile changes what the application shows, which audits must notice.
              if (saved.id === active.id) store.markChanged();
              setEditing(null);
              focusNewButton();
            }}
            onCancel={() => {
              setEditing(null);
              focusNewButton();
            }}
            apply={(next) => profiles.setProfiles(next)}
            current={() => profiles.getProfiles()}
          />
        )}
      </section>
    </ToolPanel>
  );
}

/**
 * Creating or editing one of the visitor's profiles. Fields are checked here
 * first, then by the server; an edit shows at once and is undone if the
 * server refuses it.
 */
function ProfileForm({
  profile,
  others,
  onSaved,
  onCancel,
  apply,
  current,
}: {
  profile: Profile | null;
  others: readonly Profile[];
  onSaved: (profiles: Profile[], saved: Profile) => void;
  onCancel: () => void;
  apply: (profiles: readonly Profile[]) => void;
  current: () => readonly Profile[];
}) {
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const alertId = useId();
  const form = useFocusFirstInvalid(errors, alertId);
  const title = profile ? `Edit ${profile.name}` : "New profile";

  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>("#profile-name")?.focus();
  }, [form]);

  const submit = async (data: FormData) => {
    const fields = { name: String(data.get("name") ?? ""), persona: String(data.get("persona") ?? "") as Persona, region: String(data.get("region") ?? "") };
    const invalid = profileFieldErrors(fields) ?? (nameTaken(fields.name, others) ? { name: [DUPLICATE_NAME] } : null);
    if (invalid) {
      setErrors(invalid);
      return;
    }
    const clean: ProfileFields = { name: fields.name.trim(), persona: fields.persona, region: fields.region.trim() };
    const previous = current();
    if (profile) apply(previous.map((entry) => (entry.id === profile.id ? { ...entry, ...clean } : entry)));
    setSaving(true);
    const result = profile ? await send(`/api/demo/profiles/${profile.id}`, "PATCH", clean) : await send("/api/demo/profiles", "POST", clean);
    setSaving(false);
    if (!result.ok) {
      if (profile) apply(previous);
      setErrors(result.errors);
      return;
    }
    onSaved(result.profiles, result.profile ?? { id: profile?.id ?? "", ...clean, builtIn: false });
  };

  return (
    <form
      ref={form}
      className={styles.form}
      aria-label={title}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit(new FormData(event.currentTarget));
      }}
    >
      <h4 className={styles.formTitle}>{title}</h4>
      {errors.base && (
        <FormAlert id={alertId} title={profile ? "The profile was not saved" : "The profile was not created"}>
          {errors.base.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </FormAlert>
      )}
      <TextInput id="profile-name" name="name" label="Name" defaultValue={profile?.name ?? ""} maxLength={PROFILE_FIELD_LIMIT} autoComplete="off" errors={errors.name} />
      <Select id="profile-persona" name="persona" label="Persona" description="What this person can do: only an Approver sees Approve actions." defaultValue={profile?.persona ?? PERSONAS[0]} errors={errors.persona} options={PERSONAS.map((persona) => ({ value: persona, label: persona }))} />
      <TextInput id="profile-region" name="region" label="Region" defaultValue={profile?.region ?? ""} maxLength={PROFILE_FIELD_LIMIT} autoComplete="off" errors={errors.region} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={saving}>
          {profile ? "Save profile" : "Create profile"}
        </Button>
        <Button variant="tertiary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
