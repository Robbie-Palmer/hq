"use client";

import { RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AssetTrackerError({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset(): void }>) {
  return (
    <section
      aria-labelledby="asset-tracker-error-heading"
      className="mx-auto max-w-xl rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-10 text-center"
    >
      <h1 id="asset-tracker-error-heading" className="text-2xl font-semibold">
        Asset Tracker could not open this page
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your saved browser data has not been changed. Try opening the page
        again.
      </p>
      <Button type="button" className="mt-5 min-h-11" onClick={reset}>
        <RotateCwIcon aria-hidden="true" />
        Try again
      </Button>
    </section>
  );
}
