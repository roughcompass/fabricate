/** The operator's theme preference, kept in a cookie so the server renders it. */
export const THEME_COOKIE = "fabricate-theme";
const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(value: string | undefined): Theme {
  return (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "system";
}
