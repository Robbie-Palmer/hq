"use client";

import {
  AlertTriangle,
  Check,
  Clock,
  Download,
  Flame,
  Globe,
  Loader2,
  Minus,
  Plus,
  Timer,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AddTimerPopover } from "@/components/recipes/add-timer-popover";
import {
  CookMode,
  type CookStep,
  type CookToken,
} from "@/components/recipes/cook-mode";
import { DietWarning } from "@/components/recipes/diet-notice";
import { useDiet } from "@/components/recipes/diet-provider";
import { InlineTimer } from "@/components/recipes/inline-timer";
import { RecipeShoppingListButton } from "@/components/recipes/recipe-shopping-list-button";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useScaledRecipe } from "@/hooks/use-scaled-recipe";
import { useUnitPreference } from "@/hooks/use-unit-preference";
import {
  captureRecipeProductActivity,
  captureRecipeValue,
} from "@/lib/analytics/recipe-product";
import {
  recordCookingCompletionReliably,
  recordCookingSession,
} from "@/lib/api/cooking-insights";
import { authClient } from "@/lib/auth-client";
import {
  buildIngredientAnnotationMap,
  formatIngredient,
  formatInstructionIngredientToken,
  type IngredientAnnotation,
  resolveIngredientAnnotation,
} from "@/lib/domain/recipe/ingredientDisplay";
import { tokenizeInstructionSdk } from "@/lib/domain/recipe/instructionTokens";
import type {
  IngredientGroupView,
  RecipeDetailView,
} from "@/lib/domain/recipe/recipeViews";
import { formatRecipeTime } from "@/lib/domain/recipe/time";
import {
  MEASUREMENT_SYSTEM_LABELS,
  type MeasurementPreference,
  type MeasurementSystem,
  preferenceForSystem,
} from "@/lib/domain/recipe/unit";

function IngredientGroup({
  group,
  scale,
  system,
  annotations,
  checked,
  onToggle,
}: Readonly<{
  group: IngredientGroupView;
  scale: number;
  system: MeasurementPreference;
  annotations: Map<string, IngredientAnnotation>;
  checked: Set<string>;
  onToggle: (ingredient: string) => void;
}>) {
  return (
    <div>
      {group.name && (
        <h3 className="font-semibold text-lg mb-2">{group.name}</h3>
      )}
      <ul className="space-y-1">
        {group.items.map((item) => {
          const isChecked = checked.has(item.ingredient);
          return (
            <li key={item.ingredient}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggle(item.ingredient)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={[
                    "mt-0.5 h-4 w-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors",
                    isChecked
                      ? "bg-muted-foreground border-muted-foreground"
                      : "border-muted-foreground/40 hover:border-muted-foreground",
                  ].join(" ")}
                >
                  {isChecked && (
                    <Check
                      className="h-2.5 w-2.5 text-background"
                      strokeWidth={3}
                    />
                  )}
                </span>
                <span
                  className={
                    isChecked ? "line-through text-muted-foreground/60" : ""
                  }
                >
                  {formatIngredient(
                    item,
                    scale,
                    system,
                    resolveIngredientAnnotation(item, annotations),
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function parseCookParams(search: string): { open: boolean; step: number } {
  const params = new URLSearchParams(search);
  const step = Number.parseInt(params.get("step") ?? "1", 10);
  return {
    open: params.get("cook") === "1",
    step: Number.isFinite(step) && step > 0 ? step - 1 : 0,
  };
}

function buildCookUrl(open: boolean, step: number): string {
  const url = new URL(globalThis.location.href);
  if (open) {
    url.searchParams.set("cook", "1");
    if (step > 0) {
      url.searchParams.set("step", String(step + 1));
    } else {
      url.searchParams.delete("step");
    }
  } else {
    url.searchParams.delete("cook");
    url.searchParams.delete("step");
  }
  return url.toString();
}

interface MethodTokenProps {
  readonly recipeSlug: string;
  readonly recipeTitle: string;
  readonly scale: number;
  readonly stepIndex: number;
  readonly stepText: string;
  readonly system: MeasurementPreference;
  readonly timersEnabled: boolean;
  readonly token: CookToken;
}

function MethodToken({
  recipeSlug,
  recipeTitle,
  scale,
  stepIndex,
  stepText,
  system,
  timersEnabled,
  token,
}: MethodTokenProps) {
  if (token.type === "timer") {
    if (timersEnabled && token.timerId) {
      return (
        <InlineTimer
          timerId={token.timerId}
          recipeSlug={recipeSlug}
          recipeTitle={recipeTitle}
          stepIndex={stepIndex}
          stepText={stepText}
          durationSeconds={token.durationSeconds}
          label={token.value}
        />
      );
    }
    return (
      <button
        type="button"
        disabled
        data-recipe-pill
        title="Timers are available after saving the recipe"
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-[var(--line-strong)] px-2 py-0.5 align-baseline text-[0.8125rem] font-semibold text-[var(--ink-2)] opacity-70"
      >
        <Timer className="size-3" />
        {token.value}
      </button>
    );
  }
  if (token.type === "ingredient") {
    return formatInstructionIngredientToken(token, scale, system);
  }
  return token.value;
}

function ingredientGroupClassName(index: number, hasName: boolean) {
  if (index === 0) return undefined;
  return hasName ? "border-t border-border/50 pt-4 mt-4" : "mt-4";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function RecipeContent({
  recipe,
  timersEnabled = true,
  shoppingListEnabled = true,
}: Readonly<{
  recipe: RecipeDetailView;
  timersEnabled?: boolean;
  shoppingListEnabled?: boolean;
}>) {
  const { diet, matchRecipe } = useDiet();
  const { data: authSession, isPending: authSessionPending } =
    authClient.useSession();
  const dietMatch = useMemo(
    () =>
      matchRecipe({
        ingredients: recipe.ingredientGroups.flatMap((group) =>
          group.items.map((item) => ({
            slug: item.ingredient,
            name: item.name,
          })),
        ),
      }),
    [matchRecipe, recipe.ingredientGroups],
  );
  const baseServings = Math.max(1, recipe.servings);
  const [portions, setPortions] = useState(baseServings);
  const requestedScale = portions / baseServings;
  const {
    view: effectiveRecipe,
    scaleMultiplier: scale,
    isScaling,
    error: scalingError,
  } = useScaledRecipe(recipe, requestedScale);
  const [unitPreference] = useUnitPreference();
  const [displaySystem, setDisplaySystem] = useState<MeasurementSystem | null>(
    null,
  );
  const displayPreference = useMemo(
    () => (displaySystem ? preferenceForSystem(displaySystem) : unitPreference),
    [displaySystem, unitPreference],
  );

  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    captureRecipeProductActivity("recipe_viewed", {
      recipe_slug: recipe.slug,
      recipe_source: recipe.canonical ? "imported" : "native",
    });
  }, [recipe.canonical, recipe.slug]);

  const toggleIngredient = useCallback((ingredient: string) => {
    setCheckedIngredients((prev) => {
      const next = new Set(prev);
      if (next.has(ingredient)) {
        next.delete(ingredient);
      } else {
        next.add(ingredient);
      }
      return next;
    });
  }, []);
  useEffect(() => {
    if (scalingError) {
      console.error(
        `[RecipeContent] cooklang-rs scaling failed for "${recipe.slug}" at ${requestedScale}x; falling back to JS scaling.`,
        scalingError,
      );
    }
  }, [scalingError, recipe.slug, requestedScale]);
  const ingredientAnnotations = useMemo(
    () => buildIngredientAnnotationMap(effectiveRecipe.ingredientGroups),
    [effectiveRecipe.ingredientGroups],
  );

  const instructionTokenization = useMemo(
    () =>
      effectiveRecipe.instructionSdk
        ? tokenizeInstructionSdk(effectiveRecipe.instructionSdk)
        : null,
    [effectiveRecipe.instructionSdk],
  );
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" &&
      effectiveRecipe.instructionSdk &&
      instructionTokenization?.ok === false
    ) {
      console.debug(
        `[RecipeContent] Falling back to canonical instructions for "${effectiveRecipe.slug}": ${instructionTokenization.reason}`,
      );
    }
  }, [
    effectiveRecipe.instructionSdk,
    effectiveRecipe.slug,
    instructionTokenization,
  ]);

  // One shared step model for the method list and cook mode. Timer tokens get
  // stable ids so an inline pill, the cook-mode control, and the floating
  // dock all drive the same global timer.
  const cookSteps: CookStep[] = useMemo(() => {
    if (instructionTokenization?.ok === true) {
      return instructionTokenization.steps.map((tokens, stepIndex) => ({
        // Step index keeps the key unique even when two steps read identically.
        key: `${stepIndex}:${tokens.map((token) => token.value).join("|")}`,
        tokens: tokens.map((token, tokenIndex): CookToken => {
          if (token.type !== "timer" || !timersEnabled) return token;
          return {
            ...token,
            timerId: `${recipe.slug}:s${stepIndex}:t${tokenIndex}`,
          };
        }),
        text: tokens.map((token) => token.value).join(""),
      }));
    }
    return effectiveRecipe.instructions.map((step, stepIndex) => ({
      key: `${stepIndex}:${step}`,
      tokens: null,
      text: step,
    }));
  }, [
    instructionTokenization,
    effectiveRecipe.instructions,
    recipe.slug,
    timersEnabled,
  ]);

  // Cook mode open/step state is mirrored into the URL (?cook=1&step=N) via
  // the history API: entering pushes an entry so the back button exits, step
  // changes replace in place, and reloading restores the session.
  const [cookOpen, setCookOpen] = useState(false);
  const [cookStep, setCookStep] = useState(0);
  const pushedCookEntryRef = useRef(false);
  const cookingSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const applyLocation = () => {
      const { open, step } = parseCookParams(globalThis.location.search);
      setCookOpen(open);
      setCookStep(step);
      if (!open) pushedCookEntryRef.current = false;
    };
    applyLocation();
    globalThis.addEventListener("popstate", applyLocation);
    return () => globalThis.removeEventListener("popstate", applyLocation);
  }, []);

  const openCookMode = useCallback(() => {
    captureRecipeProductActivity("cook_mode_started", {
      recipe_slug: recipe.slug,
      step_count: cookSteps.length,
    });
    globalThis.history.pushState(null, "", buildCookUrl(true, 0));
    pushedCookEntryRef.current = true;
    setCookStep(0);
    setCookOpen(true);
  }, [cookSteps.length, recipe.slug]);

  const exitCookMode = useCallback(() => {
    if (pushedCookEntryRef.current) {
      // We created the ?cook entry ourselves — back() returns to the read
      // view and the popstate handler resets state.
      globalThis.history.back();
    } else {
      // Deep link / reload straight into cook mode: rewrite in place.
      globalThis.history.replaceState(null, "", buildCookUrl(false, 0));
      setCookOpen(false);
      setCookStep(0);
    }
  }, []);

  useEffect(() => {
    if (!cookOpen) {
      cookingSessionIdRef.current = null;
      return;
    }
    if (
      cookingSessionIdRef.current ||
      (!authSession && !authSessionPending) ||
      !timersEnabled
    ) {
      return;
    }

    const sessionId = globalThis.crypto.randomUUID();
    cookingSessionIdRef.current = sessionId;
    void recordCookingSession({
      sessionId,
      recipeSlug: recipe.slug,
      recipeTitle: recipe.title,
      servings: portions,
      event: "started",
    }).catch((error: unknown) => {
      // Tracking must never interrupt cooking. Keep the same id so Finish can
      // retry by upserting the completed session.
      console.error("[RecipeContent] Could not record cook-mode start", error);
    });
  }, [
    authSession,
    authSessionPending,
    cookOpen,
    portions,
    recipe.slug,
    recipe.title,
    timersEnabled,
  ]);

  const completeCookMode = useCallback(() => {
    captureRecipeValue("recipe_cooked", {
      recipe_slug: recipe.slug,
      serving_count: portions,
      step_count: cookSteps.length,
    });
    const sessionId = cookingSessionIdRef.current;
    if (sessionId && (authSession || authSessionPending) && timersEnabled) {
      const completion = {
        sessionId,
        recipeSlug: recipe.slug,
        recipeTitle: recipe.title,
        servings: portions,
        event: "completed" as const,
      };
      const request = authSession
        ? recordCookingCompletionReliably(authSession.user.id, completion)
        : recordCookingSession(completion);
      void request.catch((error: unknown) => {
        console.error("[RecipeContent] Could not record cooked meal", error);
      });
    }
    exitCookMode();
  }, [
    authSession,
    authSessionPending,
    cookSteps.length,
    exitCookMode,
    portions,
    recipe.slug,
    recipe.title,
    timersEnabled,
  ]);

  const changeCookStep = useCallback((step: number) => {
    globalThis.history.replaceState(null, "", buildCookUrl(true, step));
    setCookStep(step);
  }, []);

  const scalingStatus = (() => {
    if (scalingError) {
      return (
        <AlertTriangle
          className="h-3 w-3 text-destructive"
          aria-label="Precise scaling unavailable; showing an approximation"
        />
      );
    }
    if (isScaling) {
      return (
        <Loader2
          className="h-3 w-3 animate-spin text-muted-foreground"
          aria-label="Scaling recipe"
        />
      );
    }
    return null;
  })();

  return (
    <>
      <header className="mb-8">
        <h1 className="rt-display text-5xl md:text-6xl mb-3 leading-[0.95]">
          {recipe.title}
        </h1>
        <p className="rt-body text-xl text-[var(--ink-2)] mb-4">
          {recipe.description}
        </p>

        {diet.active && <DietWarning match={dietMatch} className="mb-4" />}

        {recipe.canonical && (
          <p className="rt-body text-sm text-[var(--ink-2)] italic mb-4 inline-flex items-center gap-2 rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--paper-warm)] px-3 py-2">
            <Globe className="h-4 w-4 not-italic" />
            <span>
              Adapted from{" "}
              <a
                href={recipe.canonical}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-[var(--terracotta-deep)] hover:text-foreground"
              >
                the original recipe
              </a>
              .
            </span>
          </p>
        )}

        {(cookSteps.length > 0 ||
          (shoppingListEnabled && Boolean(authSession))) && (
          <div className="mb-4 flex flex-wrap gap-2">
            {shoppingListEnabled && authSession && (
              <RecipeShoppingListButton
                recipeSlug={recipe.slug}
                servings={portions}
                userId={authSession.user.id}
              />
            )}
            {cookSteps.length > 0 && (
              <Button
                size="lg"
                onClick={openCookMode}
                className="w-full sm:w-auto bg-[var(--terracotta)] text-white hover:bg-[var(--terracotta-deep)] text-base"
              >
                <Flame className="size-5" />
                Start cooking
              </Button>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPortions((p) => Math.max(1, p - 1))}
                disabled={portions <= 1}
                aria-label="Decrease portions"
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="text-center tabular-nums">
                <span className="rt-display text-2xl text-[var(--terracotta)] align-middle">
                  {portions}
                </span>{" "}
                <span className="align-middle">
                  {portions === 1 ? "serving" : "servings"}
                </span>
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setPortions((p) => p + 1)}
                aria-label="Increase portions"
              >
                <Plus className="h-3 w-3" />
              </Button>
              {scalingStatus}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs">Units:</span>
            <div className="flex items-center rounded border">
              {(["metric", "us", "uk"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDisplaySystem(s)}
                  className={[
                    "px-2 py-0.5 text-xs font-medium transition-colors first:rounded-l last:rounded-r",
                    (displaySystem ?? unitPreference.preset) === s
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                  aria-pressed={(displaySystem ?? unitPreference.preset) === s}
                >
                  {MEASUREMENT_SYSTEM_LABELS[s]}
                </button>
              ))}
              {unitPreference.preset === "custom" && (
                <button
                  type="button"
                  onClick={() => setDisplaySystem(null)}
                  className={[
                    "px-2 py-0.5 text-xs font-medium transition-colors first:rounded-l last:rounded-r",
                    displaySystem === null
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                  aria-pressed={displaySystem === null}
                >
                  Custom
                </button>
              )}
            </div>
          </div>
          {recipe.prepTime != null && (
            <div className="flex items-center gap-1">
              <Timer className="h-4 w-4" />
              <span>Prep: {formatRecipeTime(recipe.prepTime)}</span>
            </div>
          )}
          {recipe.cookTime != null && (
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>Cook: {formatRecipeTime(recipe.cookTime)}</span>
            </div>
          )}
          {recipe.totalTime != null && (
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              <span>Total: {formatRecipeTime(recipe.totalTime)}</span>
            </div>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 hover:text-foreground transition-colors"
                aria-label="Choose recipe export format"
              >
                <Download className="h-4 w-4" />
                <span>Export</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-1.5">
              <a
                href={`/recipes/${recipe.slug}.json`}
                download={`${recipe.slug}.json`}
                className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
                title="Download as schema.org Recipe JSON-LD, importable into most recipe apps"
              >
                Recipe JSON (.json)
              </a>
              <a
                href={`/recipes/${recipe.slug}.cook`}
                download={`${recipe.slug}.cook`}
                className="block rounded-md px-3 py-2 text-sm hover:bg-accent"
                title="Download as a Cooklang recipe"
              >
                Cooklang (.cook)
              </a>
            </PopoverContent>
          </Popover>
        </div>

        {recipe.cuisine.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4">
            {recipe.cuisine.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1.5 rt-mono text-[var(--ink-3)]"
              >
                <Globe className="h-3.5 w-3.5" />
                {c}
              </span>
            ))}
          </div>
        )}
      </header>

      <div
        className={
          effectiveRecipe.cookware.length > 0
            ? "mb-8 lg:grid lg:grid-cols-[1fr_280px] lg:gap-8 lg:items-start"
            : "mb-8"
        }
      >
        <section className="mb-8 lg:mb-0">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="rt-display text-4xl text-[var(--terracotta)]">
              Ingredients
            </h2>
            {checkedIngredients.size > 0 && (
              <button
                type="button"
                onClick={() => setCheckedIngredients(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Reset
              </button>
            )}
          </div>
          <div>
            {effectiveRecipe.ingredientGroups.map((group, i) => (
              <div
                key={group.name ?? i}
                className={ingredientGroupClassName(i, Boolean(group.name))}
              >
                <IngredientGroup
                  group={group}
                  scale={scale}
                  system={displayPreference}
                  annotations={ingredientAnnotations}
                  checked={checkedIngredients}
                  onToggle={toggleIngredient}
                />
              </div>
            ))}
          </div>
        </section>

        {effectiveRecipe.cookware.length > 0 && (
          <aside>
            <section className="mb-8 lg:mb-0 lg:rounded-lg lg:border lg:border-border/50 lg:p-4">
              <h2 className="rt-display text-3xl text-[var(--terracotta)] mb-4">
                Equipment
              </h2>
              <ul className="space-y-1">
                {effectiveRecipe.cookware.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-muted-foreground mt-1.5 h-1.5 w-1.5 rounded-full bg-current flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        )}
      </div>

      <section>
        <h2 className="rt-display text-4xl text-[var(--terracotta)] mb-4">
          Method
        </h2>
        {/* Keep a native decimal marker so Safari/VoiceOver retain the list
            semantics. Its text is transparent because the visible numeral is
            decorative generated content from the CSS counter below. */}
        <ol className="rt-method-steps list-decimal marker:text-transparent p-0 m-0">
          {cookSteps.map((step, stepIndex) => (
            <li
              key={step.key}
              className="border-b border-dashed border-[var(--line)] last:border-0"
            >
              <div className="flex gap-4 py-3">
                <span
                  aria-hidden="true"
                  className="rt-step-num rt-display text-3xl text-[var(--terracotta)] leading-none min-w-[2ch]"
                />
                <div className="rt-body flex-1 leading-relaxed pt-1">
                  {step.tokens
                    ? step.tokens.map((token, tokenIndex) => (
                        <span
                          key={`${tokenIndex}:${token.type}:${token.value}`}
                        >
                          <MethodToken
                            token={token}
                            recipeSlug={recipe.slug}
                            recipeTitle={recipe.title}
                            stepIndex={stepIndex}
                            stepText={step.text}
                            scale={scale}
                            system={displayPreference}
                            timersEnabled={timersEnabled}
                          />
                        </span>
                      ))
                    : step.text}
                  {/* Only offer the generic add-timer on steps that have no
                      timer of their own, so it never doubles up with a timer
                      pill or a "set a timer" prompt already in the step. */}
                  {step.tokens?.some(
                    (token) => token.type === "timer",
                  ) ? null : (
                    <>
                      {" "}
                      <AddTimerPopover
                        align="start"
                        recipeSlug={recipe.slug}
                        recipeTitle={recipe.title}
                        stepIndex={stepIndex}
                        stepText={step.text}
                        trigger={
                          <button
                            type="button"
                            className="ml-0.5 inline-flex translate-y-[1px] items-center gap-0.5 align-baseline text-[0.6875rem] text-[var(--ink-4)] opacity-70 transition-opacity hover:opacity-100 hover:text-[var(--terracotta)]"
                            aria-label="Add a timer for this step"
                          >
                            <Timer className="size-3" />
                            timer
                          </button>
                        }
                      />
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Portaled to <body> (which mirrors the recipe theme + fonts) so the
          overlay escapes the page's `z-0` stacking context and covers the
          sticky site header. */}
      {cookOpen &&
        cookSteps.length > 0 &&
        createPortal(
          <CookMode
            recipeSlug={recipe.slug}
            recipeTitle={recipe.title}
            servings={portions}
            steps={cookSteps}
            ingredientGroups={effectiveRecipe.ingredientGroups}
            annotations={ingredientAnnotations}
            scale={scale}
            system={displayPreference}
            step={cookStep}
            onStepChange={changeCookStep}
            onExit={exitCookMode}
            onComplete={completeCookMode}
          />,
          document.body,
        )}
    </>
  );
}
