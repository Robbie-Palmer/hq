import {
  ArrowRight,
  BookHeart,
  House,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react";
import Link from "next/link";
import { AuthButton } from "@/components/recipes/auth-button";
import { RecipeThumb, recipeMetaLabel } from "@/components/recipes/recipe-card";
import { RecipeList } from "@/components/recipes/recipe-list";
import { RecipePageLink } from "@/components/recipes/recipe-page-link";
import type { RecipeCardView } from "@/lib/api/recipes";
import { recipePageHref } from "@/lib/domain/recipe/recipeDraft";

const steps = [
  {
    number: "01",
    title: "See what’s cooking",
    description:
      "Browse public recipe activity and meet the cooks behind the dishes.",
    icon: Sparkles,
  },
  {
    number: "02",
    title: "Keep the good ones",
    description:
      "Create a recipe box for the dishes you want to make, tweak and return to.",
    icon: BookHeart,
  },
  {
    number: "03",
    title: "Cook as a household",
    description:
      "Share your kitchen and shopping list with the people you cook with.",
    icon: House,
  },
] as const;

function previewActionLabel(index: number) {
  if (index === 0) return "Save it";
  if (index === 1) return "Cook it";
  return "Make it yours";
}

export function LoggedOutLanding({
  recipes,
}: Readonly<{ recipes: RecipeCardView[] }>) {
  const previewRecipes = recipes.slice(0, 3);

  return (
    <div className="w-full max-w-full overflow-x-clip">
      <section className="container mx-auto grid min-w-0 max-w-7xl items-center gap-12 overflow-x-clip px-4 pt-8 pb-10 sm:pt-10 sm:pb-12 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16 lg:py-8">
        <div className="min-w-0 max-w-3xl">
          <p className="rt-mono text-[var(--terracotta)]">
            A recipe box built for real life
          </p>
          <h1 className="rt-display mt-4 break-words text-6xl leading-[0.82] tracking-[-0.035em] min-[380px]:text-[4.25rem] sm:text-[clamp(4.25rem,10vw,7.75rem)] sm:leading-[0.78]">
            Find something worth cooking.{" "}
            <span className="text-[var(--terracotta)]">
              Keep what you love.
            </span>
          </h1>
          <p className="rt-body mt-7 max-w-2xl text-lg leading-relaxed text-[var(--ink-2)] sm:text-xl">
            Follow recipe activity from home cooks, collect the dishes that earn
            a repeat, and turn scattered links into a recipe box that works in
            your kitchen.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <AuthButton
              intent="signup"
              className="h-11 px-5 text-base shadow-[var(--paper-shadow)]"
            />
            <Link
              href="/recipes/discover"
              className="rt-body inline-flex h-11 items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--card)] px-5 font-bold text-[var(--ink)] transition-colors hover:border-[var(--terracotta)] hover:text-[var(--terracotta-deep)]"
            >
              Browse activity <ArrowRight className="size-4" />
            </Link>
          </div>
          <p className="rt-mono mt-5 text-[var(--ink-3)]">
            Browse freely · make an account when you’re ready to save
          </p>
        </div>

        <div className="relative mx-auto min-w-0 w-full max-w-xl lg:mx-0">
          <div className="absolute -top-12 -right-16 hidden size-56 rounded-full bg-[var(--butter)]/30 blur-3xl sm:block" />
          <div className="absolute -bottom-12 -left-16 hidden size-56 rounded-full bg-[var(--sage)]/20 blur-3xl sm:block" />
          <div className="relative max-w-full rounded-[2rem] border border-[var(--line-strong)] bg-[var(--card)] p-5 shadow-[0_24px_70px_rgba(31,26,20,0.14)] sm:rotate-[0.6deg] sm:p-7">
            <div className="flex items-center justify-between border-b border-dashed border-[var(--line-strong)] pb-4">
              <div>
                <p className="rt-mono text-[var(--terracotta)]">
                  Your future recipe box
                </p>
                <p className="rt-display mt-1 text-3xl">Worth making again</p>
              </div>
              <span className="flex size-11 items-center justify-center rounded-full bg-[var(--butter-soft)] text-[var(--terracotta-deep)]">
                <UtensilsCrossed className="size-5" />
              </span>
            </div>
            <div className="mt-2 divide-y divide-dashed divide-[var(--line)]">
              {previewRecipes.map((recipe, index) => (
                <RecipePageLink
                  key={recipe.slug}
                  href={recipePageHref(recipe)}
                  className="group flex items-center gap-4 py-4"
                >
                  <RecipeThumb recipe={recipe} size={72} />
                  <div className="min-w-0 flex-1">
                    <p className="rt-mono text-[var(--ink-3)]">
                      {previewActionLabel(index)}
                    </p>
                    <h2 className="rt-display mt-1 truncate text-2xl transition-colors group-hover:text-[var(--terracotta)] sm:text-3xl">
                      {recipe.title}
                    </h2>
                    <p className="rt-body mt-1 truncate text-xs text-[var(--ink-3)]">
                      {recipeMetaLabel(recipe)}
                    </p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-[var(--ink-3)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--terracotta)]" />
                </RecipePageLink>
              ))}
            </div>
            <Link
              href="/recipes/discover"
              className="rt-body mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--paper-warm)] px-4 py-3 font-bold text-[var(--ink-2)] transition-colors hover:text-[var(--terracotta-deep)]"
            >
              See what other cooks are adding <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="container mx-auto max-w-7xl px-4 py-10 sm:py-12 lg:py-14">
        <div className="mb-7 max-w-2xl">
          <p className="rt-mono text-[var(--terracotta)]">Public recipes</p>
          <h2 className="rt-display mt-3 text-5xl sm:text-6xl">
            Browse the whole collection.
          </h2>
          <p className="rt-body mt-3 text-[var(--ink-2)]">
            Every public recipe is here to search, filter and cook.
          </p>
        </div>
        <RecipeList recipes={recipes} />
      </section>

      <section
        id="how-it-works"
        className="scroll-mt-32 border-y border-[var(--line)] bg-[var(--paper-warm)]/65"
      >
        <div className="container mx-auto max-w-7xl px-4 py-10 sm:py-12 lg:py-10">
          <div className="max-w-2xl">
            <p className="rt-mono text-[var(--terracotta)]">How it works</p>
            <h2 className="rt-display mt-3 text-5xl sm:text-6xl">
              From “that looks good” to dinner.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <article
                  key={step.number}
                  className="rounded-2xl border border-[var(--line-strong)] bg-[var(--card)] p-6 shadow-[var(--paper-shadow)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="rt-mono text-[var(--terracotta)]">
                      {step.number}
                    </span>
                    <Icon className="size-5 text-[var(--terracotta)]" />
                  </div>
                  <h3 className="rt-display mt-8 text-3xl">{step.title}</h3>
                  <p className="rt-body mt-3 text-sm text-[var(--ink-2)]">
                    {step.description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="container mx-auto max-w-7xl px-4 py-10 sm:py-12 lg:py-10">
        <div className="flex flex-col items-start justify-between gap-8 rounded-[2rem] border border-[var(--terracotta)] bg-[var(--butter-soft)] p-7 sm:p-10 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <p className="rt-mono text-[var(--terracotta-deep)]">
              Ready when you are
            </p>
            <h2 className="rt-display mt-3 text-4xl sm:text-5xl">
              Give the recipes you love somewhere useful to live.
            </h2>
          </div>
          <AuthButton
            intent="signup"
            className="h-11 shrink-0 px-5 text-base shadow-[var(--paper-shadow)]"
          />
        </div>
      </section>
    </div>
  );
}
