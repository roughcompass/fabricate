/**
 * Reference deployments' simulated addresses (template-demo/demo-mode spec).
 * Nothing here deploys anything: every host is on a reserved example domain.
 */

const DEMO_DOMAIN = "deweb.example";

/** A template's reference deployment's simulated address, shown in preview mode's browser window. */
export function referenceUrl(slug: string): string {
  return `https://${slug}-preview.${DEMO_DOMAIN}`;
}
