"use client";

import { useFormStatus } from "react-dom";
import { type ButtonVariant, buttonClass } from "./button";
import { Icon, type IconName } from "./icon";

/** A submit button that reports and blocks duplicate submission while its form is pending. */
export function SubmitButton({ children, variant = "primary", icon, pendingLabel }: { children: React.ReactNode; variant?: ButtonVariant; icon?: IconName; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={buttonClass(variant)} disabled={pending} aria-disabled={pending}>
      {icon && <Icon name={pending ? "spinner" : icon} />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
