"use client";

import { ArrowLeftIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface RecipesErrorProps {
  error: Error & { digest?: string };
  reset(): void;
}

export default function RecipesError({ reset }: Readonly<RecipesErrorProps>) {
  return (
    <section
      aria-labelledby="recipes-error-heading"
      className="container mx-auto flex flex-1 flex-col items-center justify-center px-4 py-16 text-center"
    >
      <div className="w-full max-w-xl rounded-xl border border-[var(--line-strong)] bg-[var(--card)] px-6 py-10 shadow-[var(--paper-shadow)]">
        <h1 id="recipes-error-heading" className="rt-display text-5xl">
          This recipe page could not be opened
        </h1>
        <p className="rt-body mt-3 text-[var(--ink-2)]">
          Retrying does not clear saved recipes or your shopping list. Return to
          the recipe index if this page keeps failing.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button type="button" className="rounded-full" onClick={reset}>
            <RotateCwIcon aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/recipes">
              <ArrowLeftIcon aria-hidden="true" />
              Back to recipes
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
