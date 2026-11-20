import Image from "next/image";
import Link from "next/link";
import { ContentTemplate } from "@/components/templates/content-template";
import { ButtonLink } from "@/components/ui/button";
import { formatNumber } from "@/components/ui/count";
import { StatGroup } from "@/components/ui/stat-group";
import { formatAbsolute } from "@/components/ui/time";
import { ABOUT, aboutBenefits } from "@/content/about";
import type { SiteFigures } from "@/lib/site/figures";
import styles from "./about.module.css";

/** One section of the page: its heading states its point. */
function Section({ id, heading, intro, children }: { id: string; heading: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={`${id}-heading`} data-about-section={id}>
      <h2 id={`${id}-heading`} className={styles.heading}>
        {heading}
      </h2>
      {intro && <p className={styles.intro}>{intro}</p>}
      {children}
    </section>
  );
}

/**
 * The marketing page (product-site spec; design decision 14) on the Content
 * template's marketing variant: a hero, then nine sections in a fixed order,
 * from why to action. Its copy is src/content/about.ts; its figures are read
 * live, each hidden while its count is zero, and the whole section while no
 * Repository is registered. Applications' benefit shows only while
 * `applications` says they're available.
 */
export function AboutView({ figures, applications }: { figures: SiteFigures; applications: boolean }) {
  const { hero } = ABOUT;
  const stats = (
    [
      ["repositories", figures.repositories],
      ["profiled", figures.profiled],
      ["saltVersions", figures.saltVersions],
    ] as const
  )
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ label: ABOUT.figures.labels[key], value: formatNumber(value) }));
  return (
    <ContentTemplate
      variant="marketing"
      hero={{
        title: hero.title,
        lead: hero.lead,
        actions: (
          <>
            <ButtonLink href={hero.actions[0].href} variant="primary" size="lg">
              {hero.actions[0].label}
            </ButtonLink>
            <ButtonLink href={hero.actions[1].href} variant="secondary" size="lg">
              {hero.actions[1].label}
            </ButtonLink>
          </>
        ),
        // The captures are already compressed, and a release serves them as they are, with no image optimizer.
        media: (
          <figure className={styles.shot}>
            <Image className={styles.shotLight} src={hero.screenshot.light} alt={hero.screenshot.alt} width={hero.screenshot.width} height={hero.screenshot.height} unoptimized />
            <Image className={styles.shotDark} src={hero.screenshot.dark} alt={hero.screenshot.alt} width={hero.screenshot.width} height={hero.screenshot.height} unoptimized />
          </figure>
        ),
      }}
    >
      {figures.repositories > 0 && (
        <Section id="figures" heading={ABOUT.figures.heading}>
          <StatGroup stats={stats} label="Live figures" />
          <p className={styles.note}>
            Read <time dateTime={figures.readAt.toISOString()}>{formatAbsolute(figures.readAt)}</time>.
          </p>
        </Section>
      )}

      <Section id="problem" heading={ABOUT.problem.heading} intro={ABOUT.problem.intro}>
        <ul className={styles.list}>
          {ABOUT.problem.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section id="agents" heading={ABOUT.agents.heading} intro={ABOUT.agents.intro}>
        <div className={styles.tableScroll} data-panel="" data-scroll-x="" tabIndex={0}>
          <table className={styles.table}>
            <thead>
              <tr>
                <td />
                <th scope="col">{ABOUT.agents.columns.agent}</th>
                <th scope="col">{ABOUT.agents.columns.registry}</th>
              </tr>
            </thead>
            <tbody>
              {ABOUT.agents.rows.map((row) => (
                <tr key={row.aspect}>
                  <th scope="row">{row.aspect}</th>
                  <td>{row.agent}</td>
                  <td>{row.registry.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="how-it-works" heading={ABOUT.howItWorks.heading}>
        <dl className={styles.parts}>
          {ABOUT.howItWorks.parts.map((part) => (
            <div key={part.name} className={styles.part}>
              <dt className={styles.partName}>{part.name}</dt>
              <dd>{part.job.text}</dd>
            </div>
          ))}
        </dl>
        <h3 className={styles.subheading}>{ABOUT.howItWorks.stepsHeading}</h3>
        <ol className={styles.steps}>
          {ABOUT.howItWorks.steps.map((step) => (
            <li key={step.text}>{step.text}</li>
          ))}
        </ol>
      </Section>

      <Section id="benefits" heading={ABOUT.benefits.heading} intro={ABOUT.benefits.intro}>
        <dl className={styles.audiences}>
          {aboutBenefits(applications).map((item) => (
            <div key={item.audience} className={styles.audience}>
              <dt className={styles.partName}>{item.audience}</dt>
              <dd>{item.benefit.text}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="trust" heading={ABOUT.trust.heading}>
        <ul className={styles.list}>
          {ABOUT.trust.claims.map((claim) => (
            <li key={claim.text}>{claim.text}</li>
          ))}
        </ul>
      </Section>

      <Section id="agent-use" heading={ABOUT.useWithAgent.heading}>
        <ul className={styles.list}>
          {ABOUT.useWithAgent.claims.map((claim) => (
            <li key={claim.text}>{claim.text}</li>
          ))}
        </ul>
        <p>
          <Link href={ABOUT.useWithAgent.guide.href}>{ABOUT.useWithAgent.guide.label}</Link>
        </p>
      </Section>

      <Section id="questions" heading={ABOUT.questions.heading}>
        <dl className={styles.questions}>
          {ABOUT.questions.items.map((item) => (
            <div key={item.question} className={styles.question}>
              <dt className={styles.partName}>{item.question}</dt>
              <dd>{item.answer.text}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="closing" heading={ABOUT.closing.heading}>
        <p className={styles.intro}>{ABOUT.closing.text}</p>
        <div className={styles.closingActions}>
          <ButtonLink href={ABOUT.closing.action.href} variant="secondary" size="lg">
            {ABOUT.closing.action.label}
          </ButtonLink>
          {ABOUT.closing.links.map((link) => (
            <Link key={link.href} href={link.href} className={styles.closingLink}>
              {link.label}
            </Link>
          ))}
        </div>
      </Section>
    </ContentTemplate>
  );
}
