import Link from "next/link";
import { Icon, type IconName } from "./icon";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export function buttonClass(variant: ButtonVariant = "secondary"): string {
  return [styles.button, variant !== "secondary" && styles[variant]].filter(Boolean).join(" ");
}

interface ButtonLinkProps extends Omit<React.ComponentProps<typeof Link>, "className"> {
  variant?: ButtonVariant;
  icon?: IconName;
}

export function ButtonLink({ variant, icon, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClass(variant)} {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  icon?: IconName;
}

export function Button({ variant, icon, children, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant)} {...props}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

interface ActionButtonProps extends ButtonProps {
  action: (formData: FormData) => void | Promise<void>;
  /** Hidden fields submitted with the action. */
  fields?: Record<string, string>;
}

/** A button that submits a Server Action through its own form; works without JavaScript. */
export function ActionButton({ action, fields = {}, ...props }: ActionButtonProps) {
  return (
    <form action={action} className={styles.inline}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" {...props} />
    </form>
  );
}
