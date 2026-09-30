import Link from "next/link";
import { type ButtonSize, type ButtonVariant, ButtonContent, buttonClass } from "./button-content";
import type { IconName } from "./icon";
import { SubmitButton } from "./submit-button";
import styles from "./button.module.css";

export { type ButtonSize, type ButtonVariant, buttonClass } from "./button-content";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** The accessible name and tooltip of an icon-only button. */
  label?: string;
}

type ButtonLinkProps = CommonProps & Omit<React.ComponentProps<typeof Link>, "className">;

export function ButtonLink({ variant, size = "md", icon, label, children, ...props }: ButtonLinkProps) {
  const iconOnly = !children;
  return (
    <Link className={buttonClass(variant, size, iconOnly)} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} {...props}>
      <ButtonContent icon={icon} size={size}>
        {children}
      </ButtonContent>
    </Link>
  );
}

type ButtonProps = CommonProps & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className">;

export function Button({ variant, size = "md", icon, label, children, type = "button", ...props }: ButtonProps) {
  const iconOnly = !children;
  return (
    <button type={type} className={buttonClass(variant, size, iconOnly)} aria-label={iconOnly ? label : undefined} title={iconOnly ? label : undefined} {...props}>
      <ButtonContent icon={icon} size={size}>
        {children}
      </ButtonContent>
    </button>
  );
}

interface ActionButtonProps extends CommonProps {
  action: (formData: FormData) => void | Promise<void>;
  /** Hidden fields submitted with the action. */
  fields?: Record<string, string>;
  children?: React.ReactNode;
  "aria-label"?: string;
}

/** A button that submits a Server Action through its own form; works without JavaScript and shows its pending state. */
export function ActionButton({ action, fields = {}, variant = "secondary", size, icon, label, children, "aria-label": ariaLabel }: ActionButtonProps) {
  return (
    <form action={action} className={styles.inline}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} size={size} icon={icon} label={label} aria-label={ariaLabel}>
        {children}
      </SubmitButton>
    </form>
  );
}
