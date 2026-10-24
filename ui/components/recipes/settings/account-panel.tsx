"use client";

import { useEffect, useRef, useState } from "react";
import { RecipeAvatar } from "@/components/recipes/recipe-avatar";
import {
  SaveStatus,
  type SaveStatusState,
} from "@/components/recipes/settings/save-status";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { PanelHead } from "./panel-head";

function Field({
  label,
  hint,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}>) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-dashed border-[var(--line)] py-4 sm:flex-row sm:items-baseline sm:gap-4">
      <div className="rt-body pt-1 text-[0.95rem] text-[var(--ink)] sm:w-36 sm:shrink-0">
        {label}
      </div>
      <div className="min-w-0 flex-1">
        {children}
        {hint && <p className="rt-mono mt-1.5 text-[var(--ink-4)]">{hint}</p>}
      </div>
    </div>
  );
}

function useAccountNameAutosave(initialName: string) {
  const [name, setName] = useState(initialName);
  const [saveState, setSaveState] = useState<SaveStatusState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const savedName = useRef(initialName);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const pending = useRef<string | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function save(value: string) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      setSaveState("error");
      setErrorMsg("Display name can't be empty.");
      return;
    }
    if (trimmed === savedName.current) return;
    // One request at a time; hold the newest value to save once it settles so
    // a debounce firing mid-request can't overlap with a blur.
    if (saving.current) {
      pending.current = trimmed;
      return;
    }
    saving.current = true;
    setSaveState("saving");
    setErrorMsg(null);
    const result = await authClient.updateUser({ name: trimmed });
    saving.current = false;
    if (!mounted.current) return;
    if (result.error) {
      pending.current = null;
      setSaveState("error");
      setErrorMsg(result.error.message ?? "Couldn't save your changes.");
      return;
    }
    savedName.current = trimmed;
    setSaveState("saved");
    // Normalise the field to the stored value, but only if the user hasn't
    // since typed something different (just whitespace apart).
    setName((current) => (current.trim() === trimmed ? trimmed : current));
    const next = pending.current;
    pending.current = null;
    if (next !== null) void save(next);
  }

  function onNameChange(value: string) {
    setName(value);
    setSaveState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(value), 800);
  }

  return {
    errorMsg,
    name,
    onNameBlur: () => void save(name),
    onNameChange,
    saveState,
  };
}

export function AccountPanel({
  user,
}: Readonly<{
  user: { name: string; email: string; image?: string | null };
}>) {
  const { errorMsg, name, onNameBlur, onNameChange, saveState } =
    useAccountNameAutosave(user.name);

  return (
    <div>
      <PanelHead
        kicker="ACCOUNT"
        title="Who you are."
        sub="Your name and photo as they appear across your recipes."
      />

      <div className="flex items-center gap-4 border-b border-dashed border-[var(--line)] py-4">
        <RecipeAvatar
          name={name}
          email={user.email}
          image={user.image}
          size={64}
        />
        <p className="rt-mono text-[var(--ink-4)]">
          Your photo comes from your linked Google or GitHub account.
        </p>
      </div>

      <Field label="Display name">
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          onBlur={onNameBlur}
          aria-label="Display name"
          className="max-w-sm bg-[var(--card)]"
        />
      </Field>

      <Field
        label="Email"
        hint="From your linked account — used to sign you in and find your recipes."
      >
        <span className="rt-mono text-[0.8125rem] normal-case tracking-normal text-[var(--ink)]">
          {user.email}
        </span>
      </Field>

      <div className="mt-4 flex items-center gap-2" aria-live="polite">
        <SaveStatus
          state={saveState}
          error={errorMsg}
          savingText="saving…"
          showErrorIcon={false}
        />
      </div>
    </div>
  );
}
