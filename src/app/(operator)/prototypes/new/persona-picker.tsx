"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formStyles } from "@/components/ui/form";
import { SearchField } from "@/components/ui/search-field";
import styles from "./persona-picker.module.css";

export interface PickablePersona {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly organizationType: string;
}

interface PersonaPickerProps {
  id: string;
  personas: readonly PickablePersona[];
  initial: readonly string[];
  max: number;
  errors?: readonly string[];
}

const matches = (persona: PickablePersona, query: string) => [persona.name, persona.role, persona.organizationType].some((field) => field.toLowerCase().includes(query));

/**
 * Chooses up to `max` personas from a workspace's library, which can hold 30
 * (personas spec, "An intent names one or more personas"). A search narrows
 * the list by name, role, or organization; the chosen personas stay listed
 * above it, each with Remove. Filtered-out rows are only hidden, so the form
 * submits every chosen persona, and without JavaScript the full list shows.
 */
export function PersonaPicker({ id, personas, initial, max, errors }: PersonaPickerProps) {
  const [chosen, setChosen] = useState<string[]>([...initial]);
  const [query, setQuery] = useState("");
  const statusId = useId();
  const needle = query.trim().toLowerCase();
  const shown = personas.filter((persona) => !needle || matches(persona, needle));
  const full = chosen.length >= max;
  const toggle = (personaId: string, on: boolean) => setChosen((current) => (on ? [...current, personaId] : current.filter((value) => value !== personaId)));
  const describedBy = errors?.length ? `${id}-error` : `${id}-description`;

  return (
    <fieldset id={id} className={formStyles.fieldset} aria-describedby={describedBy} aria-invalid={errors?.length ? true : undefined}>
      <legend className={formStyles.legend}>
        Personas<span className={formStyles.optional}> (optional)</span>
      </legend>
      {errors?.length ? (
        <p id={`${id}-error`} className={formStyles.error}>
          {errors.join(" ")}
        </p>
      ) : (
        <p id={`${id}-description`} className={formStyles.description}>
          Choose up to {max}. Every variant is written and reviewed for each persona. <Link href="/prototypes/personas">Manage personas</Link>
        </p>
      )}
      <div className={styles.chosen} data-persona-chosen="">
        <p className={styles.count}>
          {chosen.length} of {max} chosen
        </p>
        {chosen.length > 0 && (
          <ul className={styles.chips}>
            {chosen.map((personaId) => {
              const persona = personas.find((entry) => entry.id === personaId);
              if (!persona) return null;
              return (
                <li key={personaId} className={styles.chip}>
                  <span className={styles.chipName}>{persona.name}</span>
                  <Button variant="tertiary" size="sm" icon="x" label={`Remove ${persona.name}`} onClick={() => toggle(personaId, false)} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <SearchField
        id={`${id}-search`}
        label="Search personas"
        hideLabel
        size="sm"
        placeholder="Search by name, role, or organization"
        value={query}
        aria-controls={`${id}-list`}
        onChange={(event) => setQuery(event.target.value)}
        // Enter in the search would submit the composer.
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
      />
      <p id={statusId} className={styles.status} role="status">
        {needle ? (shown.length === 0 ? `No persona matches "${query.trim()}".` : `${shown.length} of ${personas.length} personas match.`) : ""}
      </p>
      <div id={`${id}-list`} className={styles.list} data-persona-list="">
        {personas.length === 0 && <p className={formStyles.description}>This workspace has no personas yet.</p>}
        {personas.map((persona) => {
          const inputId = `${id}-${persona.id}`;
          const checked = chosen.includes(persona.id);
          return (
            <label key={persona.id} className={[formStyles.choice, styles.row].join(" ")} htmlFor={inputId} hidden={!shown.includes(persona)}>
              <input
                id={inputId}
                type="checkbox"
                name="personas"
                value={persona.id}
                className={formStyles.checkbox}
                checked={checked}
                disabled={full && !checked}
                onChange={(event) => toggle(persona.id, event.target.checked)}
              />
              <span className={formStyles.choiceText}>
                <span className={formStyles.choiceLabel}>{persona.name}</span>
                <span className={formStyles.description}>{[persona.role, persona.organizationType].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
