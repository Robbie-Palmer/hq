"use client";

import { HomeIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface SiteErrorProps {
  error: Error & { digest?: string };
  reset(): void;
}

export default function SiteError({ reset }: Readonly<SiteErrorProps>) {
  return (
    <section
      aria-labelledby="site-error-heading"
      className="container mx-auto flex flex-1 flex-col items-center justify-center px-4 py-16 text-center"
    >
      <div className="w-full max-w-xl rounded-xl border bg-card px-6 py-10 shadow-sm">
        <h1 id="site-error-heading" className="text-3xl font-semibold">
          This page could not be loaded
        </h1>
        <p className="mt-3 text-muted-foreground">
          Try loading the page again. You can return home if the problem
          continues.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={reset}>
            <RotateCwIcon aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <HomeIcon aria-hidden="true" />
              Return home
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
