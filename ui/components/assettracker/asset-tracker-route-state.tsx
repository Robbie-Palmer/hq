"use client";

import { AlertTriangleIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function AssetTrackerLoadingState() {
  return (
    <div
      role="status"
      aria-label="Loading saved Asset Tracker data"
      className="space-y-8"
    >
      <div className="space-y-3">
        <Skeleton className="h-10 w-48 max-w-full" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </div>
      <span className="sr-only">Loading saved data...</span>
    </div>
  );
}

export function AssetTrackerLocalDataError({
  message,
  onRetry,
}: Readonly<{ message: string; onRetry(): void }>) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4"
    >
      <div className="flex items-start gap-3">
        <AlertTriangleIcon
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-destructive"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Saved data is unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11"
            onClick={onRetry}
          >
            <RotateCwIcon aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
