/**
 * BitBucket naming rules for the deploy form (template-demo/deployments spec).
 * No Node or database dependencies, so the form can prefill the repository
 * name as the visitor types.
 */

/** Simulated hosts use a reserved example domain (template-demo/demo-mode spec). */
export const DEMO_DOMAIN = "deweb.example";
export const BITBUCKET_HOST = `bitbucket.${DEMO_DOMAIN}`;

const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;
const REPOSITORY_NAME = /^[a-z][a-z0-9-]{1,60}[a-z0-9]$/;

/** 2 to 10 uppercase letters and digits, starting with a letter. */
export function isProjectKey(value: string): boolean {
  return PROJECT_KEY.test(value);
}

/** 3 to 62 lowercase letters, digits, and hyphens, starting with a letter and not ending with a hyphen. */
export function isRepositoryName(value: string): boolean {
  return REPOSITORY_NAME.test(value);
}

/** A repository name that meets the rules, derived from an application name. */
export function defaultRepositoryName(applicationName: string): string {
  let name = applicationName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(name)) name = `app-${name}`.replace(/-+$/, "");
  name = name.slice(0, 62).replace(/-+$/, "");
  return name.length >= 3 ? name : `${name}-app`.replace(/^-/, "");
}
