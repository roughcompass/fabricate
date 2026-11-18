import { Icon, type IconName } from "./icon";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
const ICON_SIZES: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 16 };

/** The class of a button in a variant and size, for buttons, links, and submit buttons alike. */
function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", iconOnly = false): string {
  return [styles.button, styles[variant], styles[size], iconOnly && styles.iconOnly].filter(Boolean).join(" ");
}

/**
 * A button's class and its variant as `data-variant`, for every element styled
 * as a button. The attribute lets checks find each page's primary action
 * without depending on generated class names (design-system spec, "Each
 * page's primary action uses the primary button").
 */
export function buttonProps(variant: ButtonVariant = "secondary", size: ButtonSize = "md", iconOnly = false): { className: string; "data-variant": ButtonVariant } {
  return { className: buttonClass(variant, size, iconOnly), "data-variant": variant };
}

/** A button's icon and label; an icon-only button takes its accessible name from `label`. */
export function ButtonContent({ icon, size = "md", children }: { icon?: IconName; size?: ButtonSize; children?: React.ReactNode }) {
  return (
    <>
      {icon && <Icon name={icon} size={ICON_SIZES[size]} />}
      {children}
    </>
  );
}
