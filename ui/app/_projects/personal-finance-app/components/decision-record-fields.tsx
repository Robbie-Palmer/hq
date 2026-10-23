"use client";

import {
  cloneElement,
  type HTMLInputTypeAttribute,
  type ReactElement,
  useId,
} from "react";
import { Input } from "@/components/ui/input";

export const decisionTextAreaClassName =
  "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]";

export function DecisionField({
  label,
  children,
}: Readonly<{
  label: string;
  children: ReactElement<{ id?: string }>;
}>) {
  const id = useId();
  return (
    <label className="grid gap-1.5 text-sm" htmlFor={id}>
      <span className="font-medium">{label}</span>
      {cloneElement(children, { id })}
    </label>
  );
}

export function DecisionTextInput({
  label,
  value,
  onChange,
  placeholder,
  type,
  inputMode,
  required = true,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: HTMLInputTypeAttribute;
  inputMode?: "decimal";
  required?: boolean;
}>) {
  return (
    <DecisionField label={label}>
      <Input
        required={required}
        inputMode={inputMode}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </DecisionField>
  );
}

export function DecisionTextArea({
  label,
  value,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  return (
    <DecisionField label={label}>
      <textarea
        required
        className={decisionTextAreaClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </DecisionField>
  );
}
