"use client";

import {
  Check,
  Leaf,
  LoaderCircle,
  Plus,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type DietEditorSaveState,
  useDietProfileEditor,
} from "@/hooks/use-diet-profile-editor";
import type {
  DietGroupOption,
  DietIngredientOption,
  DietOptions,
  DietPresetOption,
  DietProfile,
} from "@/lib/api/diet";
import { cn } from "@/lib/generic/styles";
import { PanelHead } from "./panel-head";

const INGREDIENT_RESULT_LIMIT = 8;

function labelFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((current) => current !== value)
    : [...values, value];
}

function summarise(
  profile: DietProfile,
  presetByKey: Map<string, DietPresetOption>,
) {
  const presetLabels = profile.presetDietKeys.map(
    (key) => presetByKey.get(key)?.label ?? labelFromSlug(key),
  );
  const displayedPresets = presetLabels.slice(0, 2);
  const remainingPresetCount = presetLabels.length - displayedPresets.length;
  const customCount =
    profile.excludedIngredientSlugs.length + profile.excludedGroupKeys.length;
  const parts = [...displayedPresets];
  if (remainingPresetCount > 0) parts.push(`+${remainingPresetCount} more`);
  if (customCount > 0) parts.push(`${customCount} custom`);
  return parts.length > 0 ? parts.join(" / ") : "No diet filters set";
}

function effectiveExclusions(
  profile: DietProfile,
  presetByKey: Map<string, DietPresetOption>,
) {
  const presetGroups = profile.presetDietKeys.flatMap(
    (key) => presetByKey.get(key)?.excludedGroupKeys ?? [],
  );
  const presetIngredients = profile.presetDietKeys.flatMap(
    (key) => presetByKey.get(key)?.excludedIngredientSlugs ?? [],
  );

  return {
    groups: unique([...presetGroups, ...profile.excludedGroupKeys]),
    ingredients: unique([
      ...presetIngredients,
      ...profile.excludedIngredientSlugs,
    ]),
  };
}

function SectionLabel({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="rt-mono mb-3 text-[var(--terracotta)]">{children}</p>;
}

function EmptyCatalogMessage({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--paper-warm)] px-4 py-3">
      <p className="rt-body text-sm text-[var(--ink-3)]">{children}</p>
    </div>
  );
}

function Status({
  state,
  error,
}: Readonly<{
  state: DietEditorSaveState;
  error: string | null;
}>) {
  const content = {
    idle: {
      icon: <span className="size-2 rounded-full bg-[var(--sage)]" />,
      text: "ready to save",
      className: "text-[var(--sage)]",
    },
    saving: {
      icon: (
        <LoaderCircle className="size-3.5 animate-spin text-[var(--ink-3)]" />
      ),
      text: "saving...",
      className: "text-[var(--ink-3)]",
    },
    saved: {
      icon: <Check className="size-3.5 text-[var(--sage)]" />,
      text: "saved",
      className: "text-[var(--sage)]",
    },
    error: {
      icon: <TriangleAlert className="size-3.5 text-[var(--destructive)]" />,
      text: error ?? "Couldn't save your diet profile.",
      className: "text-[var(--destructive)]",
    },
  }[state];

  return (
    <>
      {content.icon}
      <span
        role={state === "error" ? "alert" : undefined}
        className={cn("rt-mono", content.className)}
      >
        {content.text}
      </span>
    </>
  );
}

function CheckDot({ active }: Readonly<{ active: boolean }>) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
        active
          ? "border-[var(--terracotta)] bg-[var(--terracotta)] text-white"
          : "border-[var(--line-strong)] bg-[var(--paper)] text-transparent",
      )}
    >
      <Check className="size-3.5" />
    </span>
  );
}

function SelectableTile({
  active,
  children,
  className,
  disabled = false,
  label,
  onClick,
}: Readonly<{
  active: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
        active
          ? "border-[var(--terracotta)] bg-[var(--butter-soft)]"
          : "border-[var(--line)] bg-[var(--card)] hover:border-[var(--line-strong)]",
        disabled && "cursor-default",
        className,
      )}
    >
      <CheckDot active={active} />
      <span className="min-w-0">
        <span className="rt-body block font-semibold text-[var(--ink)]">
          {label}
        </span>
        {children}
      </span>
    </button>
  );
}

function IngredientBadge({
  ingredient,
  onRemove,
}: Readonly<{
  ingredient: DietIngredientOption & { unresolved?: boolean };
  onRemove: () => void;
}>) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--terracotta)] bg-[var(--butter-soft)] px-3 py-1 text-[0.85rem] text-[var(--ink)]">
      <span className="min-w-0">
        <span className="block truncate">{ingredient.name}</span>
        {ingredient.unresolved && (
          <span className="rt-mono block text-[0.65rem] text-[var(--ink-3)]">
            saved as written, automatic matching unavailable
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${ingredient.name}`}
        className="rounded-full text-[var(--terracotta-deep)] hover:bg-[var(--paper-warm)]"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

function IngredientMatches({
  matches,
  onAdd,
}: Readonly<{
  matches: DietIngredientOption[];
  onAdd: (ingredient: DietIngredientOption) => void;
}>) {
  if (matches.length === 0) {
    return (
      <p className="rt-body px-3 py-2 text-sm text-[var(--ink-3)]">
        No canonical ingredients match that search.
      </p>
    );
  }
  return matches.map((ingredient) => (
    <button
      key={ingredient.slug}
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onAdd(ingredient)}
      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-[var(--butter-soft)]"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-[var(--ink)]">
          {ingredient.name}
        </span>
        <span className="rt-mono block truncate text-[var(--ink-3)]">
          {ingredient.category ?? "ingredient"}
        </span>
      </span>
      <Plus className="size-4 shrink-0 text-[var(--terracotta)]" />
    </button>
  ));
}

function CustomIngredientButton({
  canAdd,
  customText,
  onAdd,
}: Readonly<{
  canAdd: boolean;
  customText: string;
  onAdd: () => void;
}>) {
  if (!canAdd) return null;
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onAdd}
      className="mt-1 flex w-full items-center gap-3 rounded-md border-t border-dashed border-[var(--line)] px-3 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--butter-soft)]"
    >
      <Plus className="size-4 shrink-0 text-[var(--terracotta)]" />
      Save "{customText}" as written
    </button>
  );
}

function IngredientPicker({
  ingredients,
  onAdd,
  onAddCustom,
  selectedSlugs,
}: Readonly<{
  ingredients: DietIngredientOption[];
  onAdd: (ingredient: DietIngredientOption) => void;
  onAddCustom: (rawText: string) => void;
  selectedSlugs: string[];
}>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);
  const hasIngredients = ingredients.length > 0;
  const selected = useMemo(() => new Set(selectedSlugs), [selectedSlugs]);
  const matches = useMemo(() => {
    const normalized = normalizeQuery(query);
    return ingredients
      .filter((ingredient) => !selected.has(ingredient.slug))
      .filter((ingredient) => {
        if (!normalized) return true;
        return `${ingredient.name} ${ingredient.category ?? ""}`
          .toLowerCase()
          .includes(normalized);
      })
      .slice(0, INGREDIENT_RESULT_LIMIT);
  }, [ingredients, query, selected]);
  const customText = query.trim();
  const normalizedCustomText = normalizeQuery(customText);
  const canAddCustom =
    customText.length > 0 &&
    !Array.from(selected).some(
      (value) => normalizeQuery(value) === normalizedCustomText,
    ) &&
    !ingredients.some(
      (ingredient) =>
        normalizeQuery(ingredient.name) === normalizedCustomText ||
        normalizeQuery(ingredient.slug) === normalizedCustomText,
    );

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  function cancelScheduledClose() {
    if (closeTimeoutRef.current === null) return;
    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = null;
  }

  function scheduleClose() {
    cancelScheduledClose();
    closeTimeoutRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimeoutRef.current = null;
    }, 120);
  }

  function addIngredient(ingredient: DietIngredientOption) {
    cancelScheduledClose();
    onAdd(ingredient);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="relative max-w-lg">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-3)]" />
      <Input
        value={query}
        onBlur={scheduleClose}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          cancelScheduledClose();
          setOpen(true);
        }}
        placeholder={
          hasIngredients
            ? `Search ${ingredients.length} ingredients or enter your own...`
            : "Enter an ingredient"
        }
        aria-autocomplete="list"
        aria-expanded={open}
        aria-label="Search or enter ingredients to exclude"
        className="bg-[var(--card)] pl-9"
      />
      {open && (
        <div className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-lg border border-[var(--line-strong)] bg-[var(--card)] p-2 shadow-lg">
          <IngredientMatches matches={matches} onAdd={addIngredient} />
          <CustomIngredientButton
            canAdd={canAddCustom}
            customText={customText}
            onAdd={() => {
              onAddCustom(customText);
              setQuery("");
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function SpecificIngredientsSection({
  ingredients,
  selectedIngredients,
  selectedSlugs,
  onAdd,
  onAddCustom,
  onRemove,
}: Readonly<{
  ingredients: DietIngredientOption[];
  selectedIngredients: Array<DietIngredientOption & { unresolved?: boolean }>;
  selectedSlugs: string[];
  onAdd: (ingredient: DietIngredientOption) => void;
  onAddCustom: (rawText: string) => void;
  onRemove: (slug: string) => void;
}>) {
  return (
    <section className="mb-7">
      <SectionLabel>SPECIFIC INGREDIENTS</SectionLabel>
      <IngredientPicker
        ingredients={ingredients}
        onAdd={onAdd}
        onAddCustom={onAddCustom}
        selectedSlugs={selectedSlugs}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {selectedIngredients.length > 0 ? (
          selectedIngredients.map((ingredient) => (
            <IngredientBadge
              key={ingredient.slug}
              ingredient={ingredient}
              onRemove={() => onRemove(ingredient.slug)}
            />
          ))
        ) : (
          <p className="rt-mono text-[var(--ink-4)]">
            Pick ingredients from the canonical recipe catalog.
          </p>
        )}
      </div>
    </section>
  );
}

function useDietPanelModel(profile: DietProfile, options: DietOptions) {
  const ingredientBySlug = useMemo(
    () =>
      new Map(
        options.ingredients.map((ingredient) => [ingredient.slug, ingredient]),
      ),
    [options.ingredients],
  );
  const presetByKey = useMemo(
    () => new Map(options.presets.map((preset) => [preset.key, preset])),
    [options.presets],
  );
  const exclusions = useMemo(
    () => effectiveExclusions(profile, presetByKey),
    [presetByKey, profile],
  );
  const selectedIngredients = profile.excludedIngredientSlugs.map((slug) => {
    const unresolved = profile.unresolvedTerms?.find(
      (term) => term.kind === "ingredient" && term.normalizedText === slug,
    );
    return (
      ingredientBySlug.get(slug) ?? {
        slug,
        name: unresolved?.rawText ?? labelFromSlug(slug),
        unresolved: true,
      }
    );
  });

  return { exclusions, presetByKey, selectedIngredients };
}

export function DietPanel() {
  const {
    actions: { save, updateProfile },
    state: { dirty, error, loading, options, profile, saveState },
  } = useDietProfileEditor();
  const { exclusions, presetByKey, selectedIngredients } = useDietPanelModel(
    profile,
    options,
  );

  function addIngredient(ingredient: DietIngredientOption) {
    updateProfile((current) => ({
      ...current,
      excludedIngredientSlugs: unique([
        ...current.excludedIngredientSlugs,
        ingredient.slug,
      ]),
    }));
  }

  function addCustomIngredient(rawText: string) {
    updateProfile((current) => ({
      ...current,
      excludedIngredientSlugs: unique([
        ...current.excludedIngredientSlugs,
        rawText,
      ]),
    }));
  }

  function removeIngredient(slug: string) {
    updateProfile((current) => ({
      ...current,
      excludedIngredientSlugs: current.excludedIngredientSlugs.filter(
        (ingredient) => ingredient !== slug,
      ),
    }));
  }

  return (
    <div>
      <PanelHead
        kicker="YOUR DIET"
        title="Set once, filters everywhere."
        sub="Choose dietary presets, then add the specific ingredient groups or ingredients you want recipes to account for."
      />

      <div className="mb-5 flex items-center gap-3 rounded-lg border border-[var(--butter)] bg-[var(--butter-soft)] px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--sage)] text-white">
          <Leaf className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="rt-body font-semibold text-[var(--ink)]">
            {summarise(profile, presetByKey)}
          </p>
          <p className="rt-mono mt-0.5 text-[var(--ink-3)]">
            {exclusions.groups.length + exclusions.ingredients.length} effective
            exclusions
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-[var(--ink-3)]">
          <LoaderCircle className="size-4 animate-spin" />
          <span className="rt-mono">loading diet profile...</span>
        </div>
      ) : (
        <>
          <section className="mb-7">
            <SectionLabel>DIETARY CHOICES</SectionLabel>
            {options.presets.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {options.presets.map((preset) => (
                  <SelectableTile
                    key={preset.key}
                    active={profile.presetDietKeys.includes(preset.key)}
                    className="min-h-20"
                    label={preset.label}
                    onClick={() =>
                      updateProfile((current) => ({
                        ...current,
                        presetDietKeys: toggleValue(
                          current.presetDietKeys,
                          preset.key,
                        ),
                      }))
                    }
                  >
                    <span className="rt-mono mt-1 block text-[var(--ink-4)]">
                      {preset.sub}
                    </span>
                  </SelectableTile>
                ))}
              </div>
            ) : (
              <EmptyCatalogMessage>
                Diet presets will appear here once the database catalog has been
                seeded.
              </EmptyCatalogMessage>
            )}
          </section>

          <section className="mb-7">
            <SectionLabel>GROUPS TO EXCLUDE OR WARN ON</SectionLabel>
            {options.groups.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {options.groups.map((group: DietGroupOption) => {
                  const coveredByPreset = profile.presetDietKeys.some((key) =>
                    presetByKey.get(key)?.excludedGroupKeys.includes(group.key),
                  );
                  return (
                    <SelectableTile
                      key={group.key}
                      active={
                        coveredByPreset ||
                        profile.excludedGroupKeys.includes(group.key)
                      }
                      disabled={coveredByPreset}
                      label={group.label}
                      onClick={() =>
                        updateProfile((current) => ({
                          ...current,
                          excludedGroupKeys: toggleValue(
                            current.excludedGroupKeys,
                            group.key,
                          ),
                        }))
                      }
                    >
                      <span className="rt-mono mt-0.5 block text-[var(--ink-4)]">
                        {group.sub}
                        {coveredByPreset && (
                          <span className="mt-0.5 block font-semibold text-[var(--sage)]">
                            covered by preset
                          </span>
                        )}
                      </span>
                    </SelectableTile>
                  );
                })}
              </div>
            ) : (
              <EmptyCatalogMessage>
                Ingredient groups will appear here once the database catalog has
                been seeded.
              </EmptyCatalogMessage>
            )}
          </section>

          <SpecificIngredientsSection
            ingredients={options.ingredients}
            selectedIngredients={selectedIngredients}
            selectedSlugs={profile.excludedIngredientSlugs}
            onAdd={addIngredient}
            onAddCustom={addCustomIngredient}
            onRemove={removeIngredient}
          />

          <section className="mb-7">
            <SectionLabel>WHEN A RECIPE BREAKS YOUR DIET</SectionLabel>
            <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--paper-warm)] p-1">
              {(
                [
                  ["hide", "Hide it"],
                  ["warn", "Show warning"],
                ] as const
              ).map(([value, label]) => {
                const active = profile.recipeMatchMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      updateProfile((current) => ({
                        ...current,
                        recipeMatchMode: value,
                      }))
                    }
                    className={cn(
                      "rt-body rounded-full px-4 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-[var(--ink)] font-semibold text-[var(--paper)]"
                        : "text-[var(--ink-2)] hover:bg-[var(--card)]",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="flex flex-col gap-3 border-t border-[var(--line)] pt-5 sm:flex-row sm:items-center">
            <Button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saveState === "saving"}
              className="bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
            >
              {saveState === "saving" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Save diet profile
            </Button>
            <div className="flex items-center gap-2" aria-live="polite">
              <Status
                state={dirty && saveState === "saved" ? "idle" : saveState}
                error={error}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
