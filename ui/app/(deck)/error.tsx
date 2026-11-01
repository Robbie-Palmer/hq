"use client";

import { FolderOpenIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface DeckErrorProps {
  error: Error & { digest?: string };
  reset(): void;
}

export default function DeckError({ reset }: Readonly<DeckErrorProps>) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <section
        aria-labelledby="deck-error-heading"
        className="w-full max-w-lg rounded-xl border bg-card px-6 py-10 text-center shadow-sm"
      >
        <h1 id="deck-error-heading" className="text-3xl font-semibold">
          The presentation stopped
        </h1>
        <p className="mt-3 text-muted-foreground">
          Retry this deck, or leave presentation mode and choose another
          project.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={reset}>
            <RotateCwIcon aria-hidden="true" />
            Retry deck
          </Button>
          <Button asChild variant="outline">
            <Link href="/projects">
              <FolderOpenIcon aria-hidden="true" />
              View projects
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
