import Image from "next/image";
import Link from "next/link";
import styles from "./media-card.module.css";

interface MediaCardProps {
  title: string;
  description: string;
  image: { src: string; alt: string };
  /** The record the card opens. Without it the card is shown as unavailable. */
  href?: string;
  /** Tags and badges under the description. */
  footer?: React.ReactNode;
  headingLevel?: 2 | 3;
}

/**
 * A record shown as a card: the title, a description clamped to two lines,
 * and a footer for tags and badges, above a preview image set at an angle and
 * cropped by the card's lower edge. The title link covers the whole card, so
 * selecting anywhere opens the record while the link stays the only focus stop.
 */
export function MediaCard({ title, description, image, href, footer, headingLevel = 3 }: MediaCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className={styles.card} aria-disabled={href ? undefined : true}>
      <div className={styles.body}>
        <Heading className={styles.title}>
          {href ? (
            <Link href={href} className={styles.link}>
              {title}
            </Link>
          ) : (
            title
          )}
        </Heading>
        <p className={styles.description}>{description}</p>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
      <div className={styles.media}>
        <div className={styles.frame}>
          <Image src={image.src} alt={image.alt} fill unoptimized sizes="(max-width: 767px) 100vw, 400px" className={styles.image} />
        </div>
      </div>
    </article>
  );
}
