"use client";

import { type ButtonVariant, buttonClass } from "./button";
import { Icon, type IconName } from "./icon";

interface ConfirmButtonProps {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  confirmation: string;
  variant?: ButtonVariant;
  icon?: IconName;
  children: React.ReactNode;
}

/** Submits a Server Action only after the operator confirms an irreversible step. */
export function ConfirmButton({ action, fields, confirmation, variant = "destructive", icon, children }: ConfirmButtonProps) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" className={buttonClass(variant)}>
        {icon && <Icon name={icon} />}
        {children}
      </button>
    </form>
  );
}
