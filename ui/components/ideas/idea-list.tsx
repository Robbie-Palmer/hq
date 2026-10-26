"use client";

import Fuse, { type IFuseOptions } from "fuse.js";
import { Lightbulb, Network } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SearchControl } from "@/components/ui/filter-bar";
import { useDebouncedSearchTracking } from "@/hooks/use-debounced-search-tracking";
import type { IdeaSummary } from "@/lib/api/ideas";

const IDEA_SEARCH_OPTIONS: IFuseOptions<IdeaSummary> = {
  keys: [
    { name: "title", weight: 3 },
    { name: "description", weight: 2 },
    { name: "content", weight: 1 },
  ],
  threshold: 0.3,
  ignoreLocation: true,
};

function IdeaCard({ idea }: Readonly<{ idea: IdeaSummary }>) {
  return (
    <Link href={`/ideas/${idea.slug}`} className="block h-full">
      <Card className="h-full transition-all hover:border-primary/50 hover:shadow-lg">
        <CardHeader>
          <CardTitle>{idea.title}</CardTitle>
          <CardDescription className="leading-6">
            {idea.description}
          </CardDescription>
          <p className="flex items-center gap-1.5 pt-2 text-xs text-muted-foreground">
            <Network className="size-3.5" />
            {idea.referenceCount} graph{" "}
            {idea.referenceCount === 1 ? "connection" : "connections"}
          </p>
        </CardHeader>
      </Card>
    </Link>
  );
}

export function IdeaList({ ideas }: Readonly<{ ideas: IdeaSummary[] }>) {
  const [query, setQuery] = useState("");
  const fuse = useMemo(() => new Fuse(ideas, IDEA_SEARCH_OPTIONS), [ideas]);
  const normalizedQuery = query.trim();
  const visibleIdeas = normalizedQuery
    ? fuse.search(normalizedQuery).map(({ item }) => item)
    : ideas;

  useDebouncedSearchTracking({
    searchQuery: query,
    resultCount: visibleIdeas.length,
    location: "ideas",
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <SearchControl
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Search ideas..."
          searchAriaLabel="Search ideas"
          stackControls={false}
        />
      </div>

      {normalizedQuery && visibleIdeas.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Showing {visibleIdeas.length} of {ideas.length} ideas matching "
          {normalizedQuery}"
        </p>
      )}

      {visibleIdeas.length === 0 ? (
        <div className="rounded-lg border bg-muted/20 py-12 text-center text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <Lightbulb className="size-10 text-muted-foreground/50" />
            <p>No ideas found matching your search.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {visibleIdeas.map((idea) => (
            <IdeaCard key={idea.slug} idea={idea} />
          ))}
        </div>
      )}
    </div>
  );
}
