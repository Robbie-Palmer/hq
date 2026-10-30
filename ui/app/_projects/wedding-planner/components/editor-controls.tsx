import type { ReactNode } from "react";

export function EditorSelect({
  value,
  onChange,
  children,
  disabled,
  label,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  label: string;
}>) {
  return (
    <select
      aria-label={label}
      className="editor-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

export function EditorField({
  label,
  hint,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  children: ReactNode;
}>) {
  return (
    <div className="editor-field">
      <span className="editor-label">{label}</span>
      {hint && <span className="editor-hint">{hint}</span>}
      {children}
    </div>
  );
}

export function EditorToggle({
  checked,
  onChange,
  title,
  description,
}: Readonly<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
}>) {
  return (
    <label className="editor-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}
