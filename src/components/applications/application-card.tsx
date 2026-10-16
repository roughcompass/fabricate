import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { RelativeTime } from "@/components/ui/relative-time";
import { Status } from "@/components/ui/status";
import { Tag } from "@/components/ui/tag";
import type { ApplicationRow } from "@/lib/applications/catalog";
import type { GitProvider } from "@/lib/applications/repository-url";
import { RENDERING_MODE_LABELS } from "@/lib/applications/vocabulary";
import { PORTAL_LIFECYCLE_LABELS } from "@/lib/onboarding/vocabulary";
import styles from "./applications.module.css";

/** The icon a repository's provider shows. */
export const PROVIDER_ICONS: Record<GitProvider, IconName> = { github: "github", bitbucket: "bitbucket", local: "folder" };

/** A repository as owner/name with its provider's icon. */
export function RepositoryLabel({ repository }: { repository: ApplicationRow["repository"] }) {
  return (
    <span className={styles.repository}>
      <Icon name={repository.provider ? PROVIDER_ICONS[repository.provider] : "git"} label={repository.provider === "github" ? "GitHub" : repository.provider === "bitbucket" ? "Bitbucket" : "Repository"} />
      <span className={styles.repositoryName}>{repository.label}</span>
    </span>
  );
}

/** A Portal's name and lifecycle badge. */
export function PortalLabel({ portal }: { portal: ApplicationRow["portal"] }) {
  return (
    <span className={styles.portal}>
      <span>{portal.label}</span>
      <Status state={portal.lifecycle} label={PORTAL_LIFECYCLE_LABELS[portal.lifecycle]} size="sm" />
    </span>
  );
}

/** A rendering determination, or a dash before the first finished assessment. */
export function RenderingLabel({ mode }: { mode: ApplicationRow["rendering"] }) {
  return mode ? <span className={styles.rendering}>{RENDERING_MODE_LABELS[mode]}</span> : <span className={styles.muted}>Not determined yet</span>;
}

/**
 * A registered Application on the Applications page (application-catalog
 * spec, "Applications are shown as cards or rows"), built like MediaCard: the
 * name links to the dashboard and covers the card. It shows the repository,
 * the Portal with its badge, the assessment state, the rendering
 * determination, and when it last changed.
 */
export function ApplicationCard({ application }: { application: ApplicationRow }) {
  return (
    <article className={styles.card} data-application={application.publicId}>
      <div className={styles.cardHead}>
        <span className={styles.avatar} aria-hidden="true">
          {application.name.trim().charAt(0).toUpperCase()}
        </span>
        <div className={styles.cardTitle}>
          <h3 className={styles.name}>
            <Link href={`/applications/${application.publicId}`} className={styles.link}>
              {application.name}
            </Link>
          </h3>
          <RepositoryLabel repository={application.repository} />
        </div>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Portal</dt>
          <dd>
            <PortalLabel portal={application.portal} />
          </dd>
        </div>
        <div>
          <dt>Assessment</dt>
          <dd>
            <Status state={application.assessment} size="sm" />
          </dd>
        </div>
        <div>
          <dt>Rendering</dt>
          <dd>
            <RenderingLabel mode={application.rendering} />
          </dd>
        </div>
      </dl>
      <p className={styles.changed}>
        Updated <RelativeTime value={application.changedAt} />
      </p>
    </article>
  );
}

export interface DemoDeploymentRow {
  publicId: string;
  name: string;
  template: string;
  environment: string;
  status: string;
  createdAt: Date;
}

/**
 * A demo deployment among the Applications, while the demo is enabled
 * (application-catalog spec, "Demo deployments appear while the demo is
 * enabled"): marked Demo, opening its demo page, with its build status, and
 * the Visit and Delete actions in +actions+, above the card's link.
 */
export function DemoDeploymentCard({ deployment, actions }: { deployment: DemoDeploymentRow; actions: React.ReactNode }) {
  return (
    <article className={styles.card} data-demo-deployment={deployment.publicId}>
      <div className={styles.cardHead}>
        <span className={styles.avatar} aria-hidden="true">
          {deployment.name.trim().charAt(0).toUpperCase()}
        </span>
        <div className={styles.cardTitle}>
          <h3 className={styles.name}>
            <Link href={`/applications/${deployment.publicId}`} className={styles.link}>
              {deployment.name}
            </Link>
          </h3>
          <span className={styles.muted}>{`${deployment.template} template`}</span>
        </div>
        <div className={styles.cardActions}>{actions}</div>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Environment</dt>
          <dd>{deployment.environment}</dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd>
            <Status state={deployment.status} size="sm" />
          </dd>
        </div>
      </dl>
      <p className={styles.changed}>
        <Tag sans>Demo</Tag> Created <RelativeTime value={deployment.createdAt} />
      </p>
    </article>
  );
}
