"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChefHat,
  Loader2,
  PenLine,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { AuthButton } from "@/components/recipes/auth-button";
import { RecipeThumb, recipeMetaLabel } from "@/components/recipes/recipe-card";
import { Button } from "@/components/ui/button";
import { useRecipeOnboarding } from "@/hooks/use-recipe-onboarding";
import type {
  DietOptions,
  DietPresetOption,
  DietProfile,
} from "@/lib/api/diet";
import type { RecipeCardView } from "@/lib/api/recipes";
import { cn } from "@/lib/generic/styles";

const STEPS = ["sign up", "your diet", "fill your box", "ready"];

function StepRailItem({
  disabled,
  index,
  label,
  onStepChange,
  step,
}: Readonly<{
  disabled: boolean;
  index: number;
  label: string;
  onStepChange: (step: number) => void;
  step: number;
}>) {
  const marker = (
    <>
      <span
        className={cn(
          "rt-mono flex size-6 items-center justify-center rounded-full border text-[0.65rem]",
          index < step &&
            "border-[var(--ink)] bg-[var(--ink)] text-[var(--butter)]",
          index === step && "border-[var(--ink)] bg-[var(--butter)]",
          index > step && "border-[var(--line-strong)] text-[var(--ink-3)]",
        )}
      >
        {index < step ? <Check className="size-3.5" /> : index + 1}
      </span>
      <span
        className={cn(
          "rt-body hidden text-sm md:inline",
          index === step
            ? "font-bold text-[var(--ink)]"
            : "text-[var(--ink-3)]",
        )}
      >
        {label}
      </span>
    </>
  );
  const canGoBack = index > 0 && index < step && !disabled;
  return (
    <li className="flex items-center gap-2">
      {index > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "hidden h-px w-5 sm:block",
            index <= step ? "bg-[var(--ink)]" : "bg-[var(--line-strong)]",
          )}
        />
      )}
      {canGoBack ? (
        <button
          type="button"
          aria-label={`Go back to ${label}`}
          onClick={() => onStepChange(index)}
          className="flex items-center gap-1.5 rounded-full outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[var(--terracotta)] focus-visible:ring-offset-2"
        >
          {marker}
        </button>
      ) : (
        <span
          aria-current={index === step ? "step" : undefined}
          className="flex items-center gap-1.5"
        >
          {marker}
        </span>
      )}
    </li>
  );
}

function StepRail({
  disabled,
  onStepChange,
  step,
}: Readonly<{
  disabled: boolean;
  onStepChange: (step: number) => void;
  step: number;
}>) {
  return (
    <ol
      aria-label="Onboarding progress"
      className="flex shrink-0 items-center gap-2"
    >
      {STEPS.map((label, index) => (
        <StepRailItem
          key={label}
          disabled={disabled}
          index={index}
          label={label}
          onStepChange={onStepChange}
          step={step}
        />
      ))}
    </ol>
  );
}

function Intro() {
  return (
    <div className="mx-auto flex max-w-full flex-1 flex-col items-center justify-center py-12 text-center sm:max-w-xl">
      <ChefHat className="size-12 text-[var(--terracotta)]" />
      <p className="rt-mono mt-5 text-[var(--terracotta)]">
        Welcome — let&apos;s set up your box
      </p>
      <h1 className="rt-display mt-3 text-5xl leading-[0.95] sm:text-7xl">
        A few minutes to a box that{" "}
        <span className="text-[var(--terracotta)]">feels yours.</span>
      </h1>
      <p className="rt-body mt-5 max-w-lg text-lg text-[var(--ink-2)]">
        Create a free account, set your diet, then choose a few recipes or write
        one of your own with Cooklang.
      </p>
      <div className="mt-7 max-w-full">
        <AuthButton intent="signup" />
      </div>
      <p className="rt-mono mt-4 text-[var(--ink-4)]">
        Google or GitHub · your recipes stay yours
      </p>
    </div>
  );
}

function DietPresetTile({
  active,
  onToggle,
  preset,
}: Readonly<{
  active: boolean;
  onToggle: (key: string) => void;
  preset: DietPresetOption;
}>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onToggle(preset.key)}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        active
          ? "border-[var(--terracotta)] bg-[var(--butter-soft)]"
          : "border-[var(--line-strong)] bg-[var(--card)] hover:border-[var(--terracotta)]",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          active
            ? "border-[var(--terracotta)] bg-[var(--terracotta)] text-white"
            : "border-[var(--line-strong)]",
        )}
      >
        <Check className="size-3.5" />
      </span>
      <span>
        <span className="rt-body block font-bold">{preset.label}</span>
        <span className="rt-mono mt-1 block text-[var(--ink-3)]">
          {preset.sub}
        </span>
      </span>
    </button>
  );
}

function StarterRecipeTile({
  onToggle,
  recipe,
  selected,
}: Readonly<{
  onToggle: (slug: string) => void;
  recipe: RecipeCardView;
  selected: boolean;
}>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(recipe.slug)}
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 text-left transition-all",
        selected
          ? "border-[var(--terracotta)] bg-[var(--butter-soft)] ring-1 ring-[var(--terracotta)]"
          : "border-[var(--line-strong)] bg-[var(--card)] hover:-translate-y-0.5 hover:shadow-[var(--paper-shadow)]",
      )}
    >
      <RecipeThumb recipe={recipe} size={54} />
      <span className="min-w-0 flex-1">
        <span className="rt-display block text-xl leading-none">
          {recipe.title}
        </span>
        <span className="rt-mono mt-1 block truncate text-[var(--ink-3)]">
          {recipeMetaLabel(recipe)}
        </span>
      </span>
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border",
          selected
            ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--butter)]"
            : "border-[var(--line-strong)]",
        )}
      >
        {selected ? <Check className="size-4" /> : "+"}
      </span>
    </button>
  );
}

function OnboardingStage({
  authoredRecipeSlugs,
  authorRecipeHref,
  boxCount,
  compatibleRecipes,
  diet,
  dietOptions,
  loading,
  onBackToChoices,
  onToggleDietPreset,
  onToggleSelectedRecipe,
  selectedSlugs,
  step,
}: Readonly<{
  authoredRecipeSlugs: string[];
  authorRecipeHref: string;
  boxCount: number;
  compatibleRecipes: RecipeCardView[];
  diet: DietProfile;
  dietOptions: DietOptions;
  loading: boolean;
  onBackToChoices: () => void;
  onToggleDietPreset: (key: string) => void;
  onToggleSelectedRecipe: (slug: string) => void;
  selectedSlugs: Set<string>;
  step: number;
}>) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="animate-spin text-[var(--terracotta)]" />
      </div>
    );
  }
  if (step === 1) {
    return (
      <section className="flex-1 py-8">
        <p className="rt-mono text-[var(--terracotta)]">
          Step 2 · filters every recipe list
        </p>
        <h1 className="rt-display mt-2 text-5xl sm:text-6xl">
          Anything you don&apos;t eat?
        </h1>
        <p className="rt-body mt-3 max-w-2xl text-[var(--ink-2)]">
          Choose any presets that fit. You can fine-tune ingredients and change
          how matches are shown later in settings.
        </p>
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {dietOptions.presets.map((preset) => (
            <DietPresetTile
              key={preset.key}
              preset={preset}
              active={diet.presetDietKeys.includes(preset.key)}
              onToggle={onToggleDietPreset}
            />
          ))}
        </div>
        {dietOptions.presets.length === 0 && (
          <p className="rt-body mt-7 rounded-xl border border-dashed p-4 text-[var(--ink-3)]">
            No diet presets are available yet. You can continue and configure
            exclusions later.
          </p>
        )}
      </section>
    );
  }
  if (step === 2) {
    return (
      <section className="flex-1 py-8">
        <p className="rt-mono text-[var(--terracotta)]">
          Step 3 · make it yours
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="rt-display mt-2 text-5xl sm:text-6xl">
              Put a few recipes in.
            </h1>
            <p className="rt-body mt-3 text-[var(--ink-2)]">
              Pick from the current collection, or author your own recipe as
              Cooklang text.
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-full">
            <Link href={authorRecipeHref}>
              <PenLine /> Write your own
            </Link>
          </Button>
        </div>
        {authoredRecipeSlugs.length > 0 && (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--sage)]/50 bg-[var(--sage)]/10 px-4 py-3">
            <PenLine className="size-5 text-[var(--sage)]" />
            <p className="rt-body">
              <b>
                {authoredRecipeSlugs.length} authored{" "}
                {authoredRecipeSlugs.length === 1 ? "recipe" : "recipes"}
              </b>{" "}
              already in your box.
            </p>
          </div>
        )}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {compatibleRecipes.map((recipe) => (
            <StarterRecipeTile
              key={recipe.slug}
              recipe={recipe}
              selected={selectedSlugs.has(recipe.slug)}
              onToggle={onToggleSelectedRecipe}
            />
          ))}
        </div>
        {compatibleRecipes.length === 0 && (
          <p className="rt-body mt-6 rounded-xl border border-dashed border-[var(--line-strong)] p-4 text-[var(--ink-3)]">
            No recipes in the current collection match your diet yet. You can
            still write one of your own with Cooklang.
          </p>
        )}
      </section>
    );
  }
  if (step !== 3) return null;
  return (
    <section className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center py-12 text-center">
      <Sparkles className="size-12 text-[var(--terracotta)]" />
      <p className="rt-mono mt-5 text-[var(--terracotta)]">
        You&apos;re all set
      </p>
      <h1 className="rt-display mt-3 text-6xl leading-none">
        Your box has {boxCount} {boxCount === 1 ? "recipe" : "recipes"}.
      </h1>
      <p className="rt-body mt-4 text-lg text-[var(--ink-2)]">
        Your diet will filter the collection, and you can keep writing recipes
        in Cooklang whenever inspiration strikes.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button variant="outline" onClick={onBackToChoices}>
          <ArrowLeft /> Back to choices
        </Button>
        <Button
          asChild
          className="rounded-full bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)]"
        >
          <Link href="/recipes">
            <BookOpen /> Open my recipe box <ArrowRight />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function OnboardingFooter({
  boxCount,
  loading,
  onBack,
  onContinue,
  onFinish,
  saving,
  step,
}: Readonly<{
  boxCount: number;
  loading: boolean;
  onBack: () => void;
  onContinue: () => Promise<void>;
  onFinish: () => Promise<void>;
  saving: boolean;
  step: number;
}>) {
  if (loading || step <= 0 || step >= 3) return null;
  return (
    <footer className="sticky bottom-0 -mx-4 mt-auto flex flex-wrap items-center gap-3 border-t border-[var(--line)] bg-[var(--paper)]/95 px-4 py-4 backdrop-blur">
      <div className="rt-body mr-auto text-[var(--ink-3)]">
        {step === 1 ? (
          "Select any that apply, or continue with none."
        ) : (
          <>
            <b className="text-[var(--ink)]">{boxCount}</b>{" "}
            {boxCount === 1 ? "recipe" : "recipes"} in your box
          </>
        )}
      </div>
      {step === 2 && (
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
      )}
      {step === 1 ? (
        <Button onClick={onContinue} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Continue{" "}
          <ArrowRight />
        </Button>
      ) : (
        <Button onClick={onFinish} disabled={saving || boxCount === 0}>
          {saving && <Loader2 className="animate-spin" />} Finish setup{" "}
          <ArrowRight />
        </Button>
      )}
    </footer>
  );
}

export function RecipeOnboarding() {
  const onboarding = useRecipeOnboarding();

  if (onboarding.sessionPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto flex min-h-[calc(100vh-10rem)] max-w-6xl flex-col px-4 py-5 md:py-8">
      <div className="flex min-w-0 items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
        <Link href="/recipes" className="rt-display min-w-0 truncate text-2xl">
          Your recipe box
        </Link>
        <StepRail
          step={onboarding.step}
          disabled={onboarding.loading || onboarding.saving}
          onStepChange={onboarding.goBackToStep}
        />
      </div>

      {!onboarding.session && <Intro />}

      {onboarding.session && (
        <OnboardingStage
          authoredRecipeSlugs={onboarding.authoredRecipeSlugs}
          authorRecipeHref={onboarding.authorRecipeHref}
          boxCount={onboarding.boxCount}
          compatibleRecipes={onboarding.compatibleRecipes}
          diet={onboarding.diet}
          dietOptions={onboarding.dietOptions}
          loading={onboarding.loading}
          onBackToChoices={() => onboarding.setStep(2)}
          onToggleDietPreset={onboarding.toggleDietPreset}
          onToggleSelectedRecipe={onboarding.toggleSelectedRecipe}
          selectedSlugs={onboarding.selectedSet}
          step={onboarding.step}
        />
      )}

      {onboarding.error && (
        <div
          role="alert"
          className="rt-body mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-destructive"
        >
          <span>{onboarding.error}</span>
          {onboarding.userId &&
            onboarding.step === 0 &&
            !onboarding.loading && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onboarding.retryLoad}
              >
                Try again
              </Button>
            )}
        </div>
      )}

      {onboarding.session && (
        <OnboardingFooter
          boxCount={onboarding.boxCount}
          loading={onboarding.loading}
          onBack={() => onboarding.setStep(1)}
          onContinue={onboarding.continueFromDiet}
          onFinish={onboarding.finishBox}
          saving={onboarding.saving}
          step={onboarding.step}
        />
      )}
    </div>
  );
}
