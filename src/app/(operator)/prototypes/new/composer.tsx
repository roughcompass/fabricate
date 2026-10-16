"use client";

import { useActionState, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { ChoiceGroup, FormAlert, FormFooter, FormNote, FormSection, TextArea, formStyles } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { SubmitButton } from "@/components/ui/submit-button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import Link from "next/link";
import type { TemplateMatch } from "@/lib/demo/gallery-templates";
import { INTENT_LENGTH, MAX_PERSONAS_PER_INTENT, TEMPLATE_VARIANT_CHOICES, VARIANT_CHOICES } from "@/lib/prototypes/limits";
import type { ComposerState } from "../form-state";
import { type PickablePersona, PersonaPicker } from "./persona-picker";

interface ComposerProps {
  action: (previous: ComposerState, formData: FormData) => Promise<ComposerState>;
  initial: ComposerState;
  personas: readonly PickablePersona[];
  remaining: number;
  limit: number;
  /** False when no model credential is configured here; Generate is then unavailable. */
  available: boolean;
  /** When today's generations run out, such as "00:00 UTC". */
  resetsAt: string;
  /** The attached template, which becomes variant 0, or null. */
  attached?: { id: string; title: string; version: number | string; href: string } | null;
  /** Usable templates matching the intent, when the gallery is available here; null when it isn't. */
  matches?: readonly TemplateMatch[] | null;
}

/**
 * New prototype (generation spec, "The composer takes an intent, scope,
 * personas, and variant count"): up to three personas, chosen from a
 * searchable list, the intent, the scope, and how many variants, with today's
 * remaining generations beside Generate. With a template attached, the
 * template is variant 0 of a page generation, beside 1 to 7 new directions.
 */
export function Composer({ action, initial, personas, remaining, limit, available, resetsAt, attached = null, matches: initialMatches = null }: ComposerProps) {
  const choices: readonly number[] = attached ? TEMPLATE_VARIANT_CHOICES : VARIANT_CHOICES;
  // Matching templates follow the intent as it changes, by the gallery's own matcher (design decision 9).
  const [matches, setMatches] = useState(initialMatches ?? []);
  const [intent, setIntent] = useState(initial.values.intent);
  const refreshMatches = async (text: string) => {
    if (initialMatches === null || attached) return;
    try {
      const response = await fetch(`/api/prototypes/template-matches?${new URLSearchParams({ intent: text })}`, { cache: "no-store" });
      if (response.ok) setMatches((await response.json()) as TemplateMatch[]);
    } catch {
      // Matches are a suggestion; Generate works without them.
    }
  };
  const [state, formAction] = useActionState(action, initial);
  const form = useFocusFirstInvalid(state, "composer-alert");
  // Generate is never unavailable without saying why, beside it.
  const blocked = !available
    ? "Generation isn't configured here: set AI_GATEWAY_API_KEY, or run vercel env pull for a Vercel OIDC token, and restart DE FabLab."
    : remaining === 0
      ? `This workspace has used all ${limit} of today's generations. More are available from ${resetsAt}.`
      : null;

  return (
    <form ref={form} action={formAction} noValidate>
      <Panel
        footer={
          <FormFooter>
            {blocked && (
              <p id="generate-blocked" className={formStyles.description} data-generate-blocked="">
                {blocked}
              </p>
            )}
            <ButtonLink href="/prototypes">Cancel</ButtonLink>
            <SubmitButton pendingLabel="Starting" icon="sparkle" disabled={Boolean(blocked)} describedBy={blocked ? "generate-blocked" : undefined}>
              Generate
            </SubmitButton>
          </FormFooter>
        }
      >
        <div className={formStyles.form}>
          {state.errors.base && <FormAlert id="composer-alert">{state.errors.base.join(" ")}</FormAlert>}
          {attached && (
            <FormNote title={`Starting from ${attached.title} v${attached.version}`} icon="layers">
              <span data-attached-template={attached.id}>
                The template is variant 0, unchanged, and the other variants each vary one thing from it. They share sample data in the template&apos;s shape. <Link href={attached.href}>View template</Link> · <Link href="/prototypes/new">Remove</Link>
              </span>
              <input type="hidden" name="template" value={attached.id} />
            </FormNote>
          )}
          {state.errors.template && <FormAlert id="composer-template-alert">{state.errors.template.join(" ")}</FormAlert>}
          <FormSection title="Who it's for">
            <PersonaPicker id="composer-personas" personas={personas} initial={initial.values.personas} max={MAX_PERSONAS_PER_INTENT} errors={state.errors.personas} />
          </FormSection>
          <FormSection title="What they need">
            <TextArea
              id="composer-intent"
              name="intent"
              label="Intent"
              description="What the persona needs to do, in a sentence or two, such as Review and release today's urgent payments before cut-off."
              rows={3}
              defaultValue={state.values.intent}
              onChange={(event) => setIntent(event.currentTarget.value)}
              onBlur={(event) => void refreshMatches(event.currentTarget.value)}
              errors={state.errors.intent}
              required
              minLength={INTENT_LENGTH.min}
              maxLength={INTENT_LENGTH.max}
            />
            {!attached && matches.length > 0 && (
              <div className={formStyles.description} role="region" aria-label="Matching templates" data-template-matches="">
                <p>Templates that match. Start from one to get it as variant 0, unchanged, beside new directions that vary from it.</p>
                <ul>
                  {matches.map((match) => (
                    <li key={match.templateId} data-template-match={match.slug}>
                      <Link href={`/templates/${match.slug}`}>{`${match.title} v${match.templateVersion}`}</Link>
                      {` · ${match.description} `}
                      <Link href={`/prototypes/new?${new URLSearchParams({ template: match.templateId, intent })}`} aria-label={`Start from ${match.title}`}>
                        Start from this
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {attached ? (
              <input type="hidden" name="scope" value="page" />
            ) : (
              <ChoiceGroup
                id="composer-scope"
                name="scope"
                legend="Scope"
                type="radio"
                choices={[
                  { value: "page", label: "Page", description: "A page body inside the common page shell." },
                  { value: "component", label: "Component", description: "One component, shown on its own." },
                ]}
                selected={[state.values.scope]}
                errors={state.errors.scope}
                columns
              />
            )}
            <ChoiceGroup
              id="composer-variants"
              name="variants"
              legend="Variants"
              type="radio"
              description={`${attached ? "Counting the template as variant 0, which uses none of today's generations. " : ""}Each new variant takes a different design direction, generated at the same time, and uses one of today's generations. Repairs use more.${remaining < choices.at(-1)! ? ` ${remaining} ${remaining === 1 ? "is" : "are"} left today, so larger counts are unavailable.` : ""}`}
              choices={choices.map((count) => ({ value: String(count), label: String(count), disabled: available && count - (attached ? 1 : 0) > remaining }))}
              selected={[state.values.variants]}
              errors={state.errors.variants}
              columns
            />
          </FormSection>
          <FormNote title={`${remaining} of ${limit} generations left today`} icon="clock">
            Each variant, refinement, and automatic repair uses one. The count resets at midnight UTC.
          </FormNote>
        </div>
      </Panel>
    </form>
  );
}
