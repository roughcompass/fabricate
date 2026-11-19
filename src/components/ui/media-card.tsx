import Image from "next/image";
import Link from "next/link";
import { Icon } from "./icon";
import styles from "./media-card.module.css";

/**
 * What the card's image area shows: a picture with its text alternative, or
 * one of a build's states in its place. `building` is a placeholder that
 * moves while a build runs, hidden from assistive technology, since the card
 * states it in text; `failure` stands for a build that never succeeded,
 * also stated in text; `unavailable` is the neutral image for a picture that
 * couldn't be taken, which says so.
 */
export type MediaCardImage = { src: string; alt: string } | { state: "building" | "failure" | "unavailable" };

interface MediaCardProps {
  title: string;
  description: string;
  image: MediaCardImage;
  /** The record the card opens. Without it the card is shown as unavailable. */
  href?: string;
  /** Tags and badges under the description. */
  footer?: React.ReactNode;
  headingLevel?: 2 | 3;
  /** A shorter preview, so four cards fit a row with the rest of the page above them. */
  compact?: boolean;
}

/**
 * A record shown as a card: the title, a description clamped to two lines,
 * and a footer for tags and badges, above a preview image set at an angle and
 * cropped by the card's lower edge. The title link covers the whole card, so
 * selecting anywhere opens the record while the link stays the only focus stop.
 */
export function MediaCard({ title, description, image, href, footer, headingLevel = 3, compact = false }: MediaCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className={styles.card} aria-disabled={href ? undefined : true} data-compact={compact ? "" : undefined}>
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
        <div className={styles.frame} data-image-state={"state" in image ? image.state : "image"}>
          <MediaImage image={image} />
        </div>
      </div>
    </article>
  );
}

/** The picture, or the build state shown in its place, as a card or a record's page shows it. */
export function MediaImage({ image, sizes = "(max-width: 767px) 100vw, 400px" }: { image: MediaCardImage; sizes?: string }) {
  if (!("state" in image)) return <Image src={image.src} alt={image.alt} fill unoptimized sizes={sizes} className={styles.image} />;
  if (image.state === "building") {
    return (
      <span className={styles.placeholder} aria-hidden="true" data-placeholder="">
        <span className={styles.placeholderBar} />
        <span className={styles.placeholderBar} data-width="short" />
        <span className={styles.placeholderBlock} />
      </span>
    );
  }
  if (image.state === "failure") {
    return (
      <span className={styles.stateImage} data-tone="error" aria-hidden="true">
        <Icon name="alert" size={24} />
        <span>No successful build yet</span>
      </span>
    );
  }
  return (
    <span className={styles.stateImage} role="img" aria-label="Screenshot unavailable">
      <Icon name="eye" size={24} />
      <span aria-hidden="true">Screenshot unavailable</span>
    </span>
  );
}
