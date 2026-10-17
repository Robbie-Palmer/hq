"use client";

import { useState } from "react";
import type {
  CookingAudience,
  CookingOutcome,
  LeftoverStorageLocation,
} from "recipe-domain/cook-log";
import { Button } from "@/components/ui/button";

function dateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function LeftoverPortionPicker({
  servings,
  value,
  onChange,
}: Readonly<{
  servings: number;
  value: number;
  onChange: (value: number) => void;
}>) {
  const portionsEaten = servings - value;
  return (
    <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--paper-warm)] p-5">
      <p className="rt-body text-sm">Portions left</p>
      <div className="mt-3 flex items-center justify-center gap-5">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Decrease leftover portions"
          disabled={value === 1}
          onClick={() => onChange(Math.max(1, value - 1))}
          className="size-12 text-2xl"
        >
          &minus;
        </Button>
        <output
          aria-label="Leftover portions"
          className="rt-display min-w-16 text-center text-5xl"
        >
          {value}
        </output>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Increase leftover portions"
          disabled={value === servings}
          onClick={() => onChange(Math.min(servings, value + 1))}
          className="size-12 text-2xl"
        >
          +
        </Button>
      </div>
      <p className="rt-mono mt-3 text-center text-[var(--ink-3)]">
        {portionsEaten} {portionsEaten === 1 ? "portion" : "portions"} eaten ·{" "}
        {value} saved for later
      </p>
    </div>
  );
}

function LeftoverStorageFields({
  storage,
  useBy,
  onStorageChange,
  onUseByChange,
}: Readonly<{
  storage: LeftoverStorageLocation;
  useBy: string;
  onStorageChange: (value: LeftoverStorageLocation) => void;
  onUseByChange: (value: string) => void;
}>) {
  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="rt-body grid gap-2 text-sm">
        <span>Stored in</span>
        <select
          aria-label="Leftover storage"
          value={storage}
          onChange={(event) =>
            onStorageChange(
              event.currentTarget.value as LeftoverStorageLocation,
            )
          }
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-3"
        >
          <option value="fridge">Fridge</option>
          <option value="freezer">Freezer</option>
        </select>
      </label>
      <label className="rt-body grid gap-2 text-sm">
        <span>Use by</span>
        <input
          aria-label="Leftover use by"
          type="date"
          value={useBy}
          onChange={(event) => onUseByChange(event.currentTarget.value)}
          className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-3"
        />
      </label>
    </div>
  );
}

function AudienceField({
  value,
  onChange,
}: Readonly<{
  value: CookingAudience;
  onChange: (value: CookingAudience) => void;
}>) {
  return (
    <label className="rt-body mt-5 grid gap-2 text-sm">
      <span>Available to</span>
      <select
        aria-label="Leftover audience"
        value={value}
        onChange={(event) =>
          onChange(event.currentTarget.value as CookingAudience)
        }
        className="h-10 rounded-md border border-[var(--line-strong)] bg-[var(--card)] px-3"
      >
        <option value="personal">Only me</option>
        <option value="household">My household</option>
      </select>
    </label>
  );
}

function OutcomeDialogHeader({
  recipeTitle,
  servings,
}: Readonly<{ recipeTitle: string; servings: number }>) {
  return (
    <>
      <p className="rt-mono text-[var(--terracotta)]">Meal complete</p>
      <h2 id="cooking-outcome-title" className="rt-display mt-1 text-4xl">
        Save leftovers from {recipeTitle}
      </h2>
      <p className="rt-body mt-2 text-sm text-[var(--ink-3)]">
        This recipe makes {servings} {servings === 1 ? "portion" : "portions"}.
        Track what is left so it shows up in your kitchen.
      </p>
    </>
  );
}

function OutcomeDialogActions({
  onBack,
  onSave,
}: Readonly<{ onBack: () => void; onSave: () => void }>) {
  return (
    <div className="mt-6 flex justify-end gap-3">
      <Button type="button" variant="outline" onClick={onBack}>
        Back
      </Button>
      <Button
        type="button"
        onClick={onSave}
        className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
      >
        Save leftovers
      </Button>
    </div>
  );
}

export function CookingOutcomeDialog({
  recipeTitle,
  servings,
  onBack,
  onSave,
}: Readonly<{
  recipeTitle: string;
  servings: number;
  onBack: () => void;
  onSave: (outcome: CookingOutcome) => void;
}>) {
  const [leftoverPortions, setLeftoverPortions] = useState(1);
  const [leftoverStorage, setLeftoverStorage] =
    useState<LeftoverStorageLocation>("fridge");
  const [leftoverUseBy, setLeftoverUseBy] = useState(dateAfter(3));
  const [audience, setAudience] = useState<CookingAudience>("personal");

  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cooking-outcome-title"
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-[var(--paper)] p-5 shadow-2xl sm:rounded-2xl sm:p-7"
      >
        <OutcomeDialogHeader recipeTitle={recipeTitle} servings={servings} />

        <LeftoverPortionPicker
          servings={servings}
          value={leftoverPortions}
          onChange={setLeftoverPortions}
        />
        <LeftoverStorageFields
          storage={leftoverStorage}
          useBy={leftoverUseBy}
          onStorageChange={setLeftoverStorage}
          onUseByChange={setLeftoverUseBy}
        />
        <AudienceField value={audience} onChange={setAudience} />

        <OutcomeDialogActions
          onBack={onBack}
          onSave={() =>
            onSave({
              leftoverPortions,
              leftoverStorage,
              leftoverUseBy: leftoverUseBy || null,
              audience,
            })
          }
        />
      </section>
    </div>
  );
}
