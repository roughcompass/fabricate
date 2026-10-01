"use client";

import { useFormStatus } from "react-dom";
import { type ButtonSize, type ButtonVariant, ButtonContent, buttonProps } from "./button-content";
import type { IconName } from "./icon";

interface SubmitButtonProps {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** The accessible name of an icon-only button. */
  label?: string;
  /** An accessible name that adds context to a visible label, such as "Disable orders". */
  "aria-label"?: string;
  /** Announced while the form is pending. */
  pendingLabel?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
  autoFocus?: boolean;
}

/**
 * A submit button that shows a spinner and blocks repeated submission while
 * its form is pending. The label stays in place, transparent, so the button
 * keeps its width.
 */
export function SubmitButton({ children, variant = "primary", size = "md", icon, label, "aria-label": ariaLabel, pendingLabel, disabled, name, value, autoFocus }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const iconOnly = !children;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      {...buttonProps(variant, size, iconOnly)}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      aria-label={ariaLabel ?? (iconOnly ? label : undefined)}
      title={iconOnly ? label : undefined}
      autoFocus={autoFocus}
    >
      <ButtonContent icon={icon} size={size}>
        {children}
      </ButtonContent>
      {pending && pendingLabel && <span className="visually-hidden">{pendingLabel}</span>}
    </button>
  );
}
