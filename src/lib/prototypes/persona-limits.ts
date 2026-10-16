/** A persona's field lengths and list sizes (prototypes/personas spec), shared by the form and the checks. */
export const PERSONA_FIELDS = {
  name: 80,
  role: 120,
  organizationType: 120,
  goal: 200,
  context: 1_000,
  constraint: 200,
  distinction: 300,
} as const;
export const MAX_GOALS = 5;
export const MAX_CONSTRAINTS = 5;
