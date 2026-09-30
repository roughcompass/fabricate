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

interface FieldBaseProps {
  id: string;
  label: string;
  /** Guidance shown below the control; an error takes its place. */
  description?: React.ReactNode;
  optional?: boolean;
  errors?: readonly string[];
  /** Keeps the label for assistive technology only, as in a table row. */
  hideLabel?: boolean;
}

function describedBy(id: string, description: React.ReactNode, errors?: readonly string[]): string | undefined {
  if (errors?.length) return `${id}-error`;
  return description ? `${id}-description` : undefined;
}

function Message({ id, description, errors }: { id: string; description: React.ReactNode; errors?: readonly string[] }) {
  if (errors?.length) {
    return (
      <p id={`${id}-error`} className={styles.error}>
        {errors.join(" ")}
      </p>
    );
  }
  return description ? (
    <p id={`${id}-description`} className={styles.description}>
      {description}
    </p>
  ) : null;
}

function Label({ id, label, optional, hideLabel }: Pick<FieldBaseProps, "id" | "label" | "optional" | "hideLabel">) {
  return (
    <label htmlFor={id} className={hideLabel ? "visually-hidden" : styles.label}>
      {label}
      {optional && <span className={styles.optional}> (optional)</span>}
    </label>
  );
}

/** A label, a control, and its description or error, in that order. */
export function Field({ id, label, description, optional, errors, hideLabel, children }: FieldBaseProps & { children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <Label id={id} label={label} optional={optional} hideLabel={hideLabel} />
      {children}
      <Message id={id} description={description} errors={errors} />
    </div>
  );
}

type Size = "sm" | "md";

interface TextInputProps extends FieldBaseProps, Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "size"> {
  mono?: boolean;
  size?: Size;
}

export function TextInput({ id, label, description, optional, errors, hideLabel, mono = false, size = "md", ...input }: TextInputProps) {
  return (
    <Field id={id} label={label} description={description} optional={optional} errors={errors} hideLabel={hideLabel}>
      <input
        id={id}
        type="text"
        className={[styles.input, mono && styles.mono, size === "sm" && styles.small].filter(Boolean).join(" ")}
        aria-describedby={describedBy(id, description, errors)}
        aria-invalid={errors?.length ? true : undefined}
        {...(mono && { autoComplete: "off", spellCheck: false, autoCapitalize: "off" })}
        {...input}
      />
    </Field>
  );
}

type TextAreaProps = FieldBaseProps & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">;

export function TextArea({ id, label, description, optional, errors, hideLabel, rows = 3, ...textarea }: TextAreaProps) {
  return (
    <Field id={id} label={label} description={description} optional={optional} errors={errors} hideLabel={hideLabel}>
      <textarea
        id={id}
        rows={rows}
        className={styles.textarea}
        aria-describedby={describedBy(id, description, errors)}
        aria-invalid={errors?.length ? true : undefined}
        {...textarea}
      />
    </Field>
  );
}

interface SelectProps extends FieldBaseProps, Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id" | "className" | "size"> {
  options: readonly { value: string; label: string }[];
  size?: Size;
}

export function Select({ id, label, description, optional, errors, hideLabel, options, size = "md", ...select }: SelectProps) {
  return (
    <Field id={id} label={label} description={description} optional={optional} errors={errors} hideLabel={hideLabel}>
      <span className={styles.selectWrap}>
        <select
          id={id}
          className={[styles.select, size === "sm" && styles.small].filter(Boolean).join(" ")}
          aria-describedby={describedBy(id, description, errors)}
          aria-invalid={errors?.length ? true : undefined}
          {...select}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevronDown" size={14} className={styles.chevron} />
      </span>
    </Field>
  );
}

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "className" | "type"> {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Keeps the label for assistive technology only, as in a table's selection column. */
  hideLabel?: boolean;
}

/** A single check box with its label beside it. */
export function Checkbox({ id, label, description, hideLabel = false, ...input }: CheckboxProps) {
  if (hideLabel) {
    return (
      <span className={styles.checkboxOnly}>
        <input id={id} type="checkbox" className={styles.checkbox} {...input} />
        <label htmlFor={id} className="visually-hidden">
          {label}
        </label>
      </span>
    );
  }
  return (
    <label className={styles.checkboxRow} htmlFor={id}>
      <input id={id} type="checkbox" className={styles.checkbox} aria-describedby={description ? `${id}-description` : undefined} {...input} />
      <span className={styles.choiceText}>
        <span>{label}</span>
        {description && (
          <span id={`${id}-description`} className={styles.description}>
            {description}
          </span>
        )}
      </span>
    </label>
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
  description?: React.ReactNode;
  optional?: boolean;
  errors?: readonly string[];
  /** Lays the cards out side by side on wide screens. */
  columns?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

/** Radio or check box choices rendered as selectable cards. */
export function ChoiceGroup({ id, name, legend, type, choices, selected, description, optional, errors, columns = false, onChange }: ChoiceGroupProps) {
  return (
    <fieldset className={styles.fieldset} aria-describedby={describedBy(id, description, errors)} aria-invalid={errors?.length ? true : undefined}>
      <legend className={styles.legend}>
        {legend}
        {optional && <span className={styles.optional}> (optional)</span>}
      </legend>
      <div className={[styles.choices, columns && styles.columns].filter(Boolean).join(" ")}>
        {choices.map((choice) => {
          const inputId = `${id}-${choice.value.replace(/[^A-Za-z0-9_-]/g, "_")}`;
          return (
            <label key={choice.value} className={styles.choice} htmlFor={inputId}>
              <input
                id={inputId}
                type={type}
                name={name}
                value={choice.value}
                className={type === "radio" ? styles.radio : styles.checkbox}
                defaultChecked={selected.includes(choice.value)}
                disabled={choice.disabled}
                onChange={onChange}
              />
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{choice.label}</span>
                {choice.description && <span className={styles.description}>{choice.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
      <Message id={id} description={description} errors={errors} />
    </fieldset>
  );
}

/** A titled group of fields within a form. */
export function FormSection({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A form's actions: Cancel, then the primary action, right-aligned; stacked on narrow screens. */
export function FormFooter({ children }: { children: React.ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

/** An error that is not about one field, such as a concurrent edit; focused after a rejected submission. */
export function FormAlert({ id, title, children }: { id: string; title?: string; children: React.ReactNode }) {
  return (
    <div id={id} className={styles.alert} role="alert" tabIndex={-1}>
      <Icon name="xCircle" className={styles.alertIcon} />
      <div className={styles.alertBody}>
        {title && <p className={styles.alertTitle}>{title}</p>}
        {children}
      </div>
    </div>
  );
}
