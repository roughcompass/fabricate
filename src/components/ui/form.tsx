import { Icon } from "./icon";
import styles from "./form.module.css";

export const formStyles = styles;

/** Values and field-addressed errors a form action returns. */
export interface FormState<Values> {
  values: Values;
  errors: Partial<Record<string, string[]>>;
  /** Monotonic id so a client can react to each submission. */
  submission?: number;
}

function describedBy(id: string, hint?: React.ReactNode, errors?: readonly string[]): string | undefined {
  return [hint ? `${id}-hint` : null, errors?.length ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

interface FieldProps {
  id: string;
  label: string;
  hint?: React.ReactNode;
  optional?: boolean;
  errors?: readonly string[];
  children: React.ReactNode;
}

export function Field({ id, label, hint, optional, errors, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {optional && <span className={styles.optional}> (optional)</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {children}
      {errors?.length ? (
        <p id={`${id}-error`} className={styles.error}>
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "className"> {
  id: string;
  label: string;
  hint?: React.ReactNode;
  optional?: boolean;
  errors?: readonly string[];
  mono?: boolean;
}

export function TextInput({ id, label, hint, optional, errors, mono = false, ...input }: TextInputProps) {
  return (
    <Field id={id} label={label} hint={hint} optional={optional} errors={errors}>
      <input
        id={id}
        type="text"
        className={mono ? `${styles.input} ${styles.mono}` : styles.input}
        aria-describedby={describedBy(id, hint, errors)}
        aria-invalid={errors?.length ? true : undefined}
        {...(mono && { autoComplete: "off", spellCheck: false, autoCapitalize: "off" })}
        {...input}
      />
    </Field>
  );
}

interface TextAreaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className"> {
  id: string;
  label: string;
  hint?: React.ReactNode;
  optional?: boolean;
  errors?: readonly string[];
}

export function TextArea({ id, label, hint, optional, errors, ...textarea }: TextAreaProps) {
  return (
    <Field id={id} label={label} hint={hint} optional={optional} errors={errors}>
      <textarea id={id} className={styles.textarea} aria-describedby={describedBy(id, hint, errors)} aria-invalid={errors?.length ? true : undefined} {...textarea} />
    </Field>
  );
}

export interface Choice {
  value: string;
  label: string;
  description?: React.ReactNode;
  disabled?: boolean;
}

interface ChoiceGroupProps {
  id: string;
  name: string;
  legend: string;
  type: "radio" | "checkbox";
  choices: readonly Choice[];
  selected: readonly string[];
  hint?: React.ReactNode;
  errors?: readonly string[];
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

/** Radio or check box choices rendered as selectable rows. */
export function ChoiceGroup({ id, name, legend, type, choices, selected, hint, errors, onChange }: ChoiceGroupProps) {
  return (
    <fieldset className={styles.fieldset} aria-describedby={describedBy(id, hint, errors)} aria-invalid={errors?.length ? true : undefined}>
      <legend className={styles.legend}>{legend}</legend>
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      <div className={styles.choices}>
        {choices.map((choice) => {
          const inputId = `${id}-${choice.value.replace(/[^A-Za-z0-9_-]/g, "_")}`;
          return (
            <label key={choice.value} className={styles.choice} htmlFor={inputId}>
              <input
                id={inputId}
                type={type}
                name={name}
                value={choice.value}
                defaultChecked={selected.includes(choice.value)}
                disabled={choice.disabled}
                onChange={onChange}
              />
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{choice.label}</span>
                {choice.description && <span className={styles.choiceDescription}>{choice.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {errors?.length ? (
        <p id={`${id}-error`} className={styles.error}>
          {errors.join(" ")}
        </p>
      ) : null}
    </fieldset>
  );
}

export function ErrorSummary({ id, messages, title = "Please correct the following:" }: { id?: string; messages: readonly string[]; title?: string }) {
  if (messages.length === 0) return null;
  return (
    <div id={id} className={styles.summary} role="alert" tabIndex={-1}>
      <h2>
        <Icon name="xCircle" />
        {title}
      </h2>
      <ul>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

export function FormActions({ children }: { children: React.ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
