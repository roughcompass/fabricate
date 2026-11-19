import { ButtonLink, Button } from "@/components/ui/button";
import { buttonProps } from "@/components/ui/button-content";
import { ICON_NAMES, Icon } from "@/components/ui/icon";
import { Row, Specimen } from "../specimen";
import styles from "../design-system.module.css";

/** The role colors the Color specimen shows; docs/design-system.md describes each. */
const COLOR_ROLES: [token: string, role: string][] = [
  ["--color-canvas", "Page background, sidebar, and header"],
  ["--color-bg", "Content surfaces"],
  ["--color-bg-selected", "Selected items"],
  ["--color-primary", "Primary buttons, checked controls, and filled marks"],
  ["--color-accent", "Links and focus"],
  ["--color-accent-subtle", "Selection highlight and targeted outlines"],
  ["--color-progress", "In-progress status"],
];

/** The foundations: color, icons, and buttons. */
export function FoundationSpecimens() {
  return (
    <>
      <Specimen
        id="color"
        title="Color"
        description="The role colors: a gray canvas behind white surfaces, monochrome emphasis, and blue only for links, focus, and progress."
        render={() => (
          <ul className={styles.swatches}>
            {COLOR_ROLES.map(([token, role]) => (
              <li key={token} className={styles.swatchItem} data-swatch={token}>
                <span className={styles.swatch} style={{ "--_swatch": `var(${token})` } as React.CSSProperties} aria-hidden="true" />
                <code>{token}</code>
                <span className={styles.swatchRole}>{role}</span>
              </li>
            ))}
          </ul>
        )}
      />

      <Specimen
        id="icons"
        title="Icons"
        description="Every icon on the 24px grid, drawn in the current text color. An icon beside text is decorative; an icon alone needs an accessible name."
        render={() => (
          <ul className={styles.icons}>
            {ICON_NAMES.map((name) => (
              <li key={name} className={styles.iconItem} data-icon={name}>
                <Icon name={name} size={20} />
                <code>{name}</code>
              </li>
            ))}
          </ul>
        )}
      />

      <Specimen
        id="buttons"
        title="Buttons"
        description="Primary for the one main action, secondary for others, tertiary for quiet actions, and danger only to confirm a destructive action."
        render={(theme) => (
          <>
            <Row label="Variants">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="tertiary">Tertiary</Button>
              <Button variant="danger">Danger</Button>
            </Row>
            <Row label="Sizes">
              <Button size="sm" data-size-sample={theme === "light" ? "sm" : undefined}>
                Small
              </Button>
              <Button data-size-sample={theme === "light" ? "md" : undefined}>Medium</Button>
              <Button size="lg">Large</Button>
            </Row>
            <Row label="With icons">
              <Button variant="primary" icon="plus">
                New Assessment
              </Button>
              <ButtonLink href="#buttons" icon="edit">
                Edit
              </ButtonLink>
              <Button icon="more" label="More actions" size="sm" />
              <Button icon="copy" label="Copy" variant="tertiary" />
            </Row>
            <Row label="States">
              <Button disabled>Disabled</Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
              <button type="button" {...buttonProps("primary")} data-pending aria-busy>
                Pending
              </button>
              <button type="button" {...buttonProps("secondary")} data-pending aria-busy>
                Pending
              </button>
            </Row>
          </>
        )}
      />
    </>
  );
}
