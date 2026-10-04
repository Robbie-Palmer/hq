import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RecipeLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="animate-spin text-[var(--terracotta)]" />
    </div>
  );
}

export function RecipeLoadError({
  title,
  message,
}: Readonly<{ title: string; message: string }>) {
  return (
    <div className="container mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="rt-display text-5xl">{title}</h1>
      <p className="rt-body mt-3 text-[var(--ink-2)]">{message}</p>
      <Button asChild variant="outline" className="mt-6 rounded-full">
        <a href="/recipes">
          <ArrowLeft /> Back to recipes
        </a>
      </Button>
    </div>
  );
}

function getRecipeQueryStatus({
  error,
  hasData,
  isFetching,
  isStale,
  subject,
}: Readonly<{
  error: unknown;
  hasData: boolean;
  isFetching: boolean;
  isStale: boolean;
  subject: string;
}>): { message: string | null; tone: string } {
  const defaultTone = "border-[var(--line)] bg-[var(--paper-warm)]";
  if (error) {
    const message = hasData
      ? `The latest refresh failed; cached data for ${subject} is still shown.`
      : `${subject.charAt(0).toUpperCase()}${subject.slice(1)} could not be loaded.`;
    return {
      message,
      tone: "border-[var(--terracotta)]/30 bg-[var(--terracotta)]/5 text-[var(--ink-2)]",
    };
  }
  if (hasData && isFetching) {
    return { message: `Refreshing ${subject}…`, tone: defaultTone };
  }
  if (hasData && isStale) {
    return {
      message: `Cached data for ${subject} is shown; updates will refresh in the background.`,
      tone: defaultTone,
    };
  }
  return { message: null, tone: defaultTone };
}

export function RecipeQueryStatus({
  error,
  hasData,
  isFetching,
  isStale,
  subject,
}: Readonly<{
  error: unknown;
  hasData: boolean;
  isFetching: boolean;
  isStale: boolean;
  subject: string;
}>) {
  const { message, tone } = getRecipeQueryStatus({
    error,
    hasData,
    isFetching,
    isStale,
    subject,
  });

  if (!message) return null;

  return (
    <output
      aria-live="polite"
      className={`rt-body container mx-auto my-4 block max-w-5xl rounded-lg border px-4 py-3 text-sm text-[var(--ink-3)] ${tone}`}
    >
      {message}
    </output>
  );
}
